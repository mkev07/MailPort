use std::{
    fs, io,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    sync::Mutex,
    time::Duration,
};

use mailport_core::transfer::{package_code, ImportRequest};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    sync::oneshot,
};

use crate::{receiver_identity::PeerToken, vault};

const READ_LIMIT: u32 = 4096;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const ENDPOINT: &str = "direct-import.sock";
const LINK_ENDPOINT: &str = "mailspring-link.sock";
const LINK_REQUEST: &[u8] = b"mailport-link-v1\n";
const LINK_REPLY: &[u8] = b"ready\n";
// Trust comes from the Vault build, never from a name or key supplied by a peer.
const RECEIVER_REQUIREMENT: Option<&str> = option_env!("MAILPORT_DIRECT_RECEIVER_REQUIREMENT");

#[derive(Default)]
pub struct DirectImport(Mutex<Option<Pending>>);

struct Pending {
    id: String,
    request: Option<ImportRequest>,
    receiver_verified: bool,
    reply: oneshot::Sender<Delivery>,
}

impl Pending {
    fn take_verified_request(
        &mut self,
        verified_code: &str,
    ) -> Result<ImportRequest, &'static str> {
        let request = self
            .request
            .as_ref()
            .ok_or("The import request has closed.")?;
        if request.verification_code() != verified_code.trim().to_ascii_uppercase() {
            return Err(
                "That request code doesn’t match Mailspring. Check the code and try again.",
            );
        }
        self.request.take().ok_or("The import request has closed.")
    }
}

struct Delivery {
    package: String,
    written: oneshot::Sender<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectRequest {
    id: String,
    accounts: Vec<(String, String)>,
    receiver_verified: bool,
}

pub fn start(app: &AppHandle) -> io::Result<()> {
    let dir = app.path().app_data_dir().map_err(io::Error::other)?;
    let uid = fs::metadata(&dir)?.uid();
    let path = dir.join(ENDPOINT);
    if let Ok(existing) = fs::symlink_metadata(&path) {
        if !existing.file_type().is_socket() || existing.uid() != uid {
            return Err(io::Error::other("Unexpected direct import socket path"));
        }
        if std::os::unix::net::UnixStream::connect(&path).is_ok() {
            return Err(io::Error::other("Direct import socket is already active"));
        }
        fs::remove_file(&path)?;
    }
    let listener = std::os::unix::net::UnixListener::bind(&path)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(listener) = UnixListener::from_std(listener) else {
            return;
        };
        while let Ok((stream, _)) = listener.accept().await {
            // Only one handoff can be active. Bound the listen backlog and avoid
            // creating unbounded readers for competing connections.
            if stream.peer_cred().is_ok_and(|peer| peer.uid() == uid) {
                let _ = handle(&app, stream).await;
            }
        }
    });
    Ok(())
}

async fn read_request(stream: &mut UnixStream) -> io::Result<ImportRequest> {
    let len = stream.read_u32().await?;
    if len == 0 || len > READ_LIMIT {
        return Err(io::Error::other("Invalid request length"));
    }
    let mut bytes = vec![0; len as usize];
    stream.read_exact(&mut bytes).await?;
    std::str::from_utf8(&bytes)
        .map_err(io::Error::other)
        .and_then(|text| ImportRequest::parse(text).map_err(io::Error::other))
}

async fn handle(app: &AppHandle, mut stream: UnixStream) -> io::Result<()> {
    let request = tokio::time::timeout(Duration::from_secs(3), read_request(&mut stream)).await??;
    if request.client_name != "Mailspring" {
        return Err(io::Error::other("Unsupported import client"));
    }

    let peer = PeerToken::read(&stream);
    let receiver_verified = match (peer.as_ref(), RECEIVER_REQUIREMENT) {
        (Some(peer), Some(requirement)) => peer.satisfies(requirement),
        _ => false,
    };
    if RECEIVER_REQUIREMENT.is_some() && !receiver_verified {
        return Err(io::Error::other("Untrusted direct import receiver"));
    }

    let state = app.state::<DirectImport>();
    let id = uuid::Uuid::new_v4().to_string();
    let (reply, response) = oneshot::channel();
    *state
        .0
        .lock()
        .map_err(|_| io::Error::other("Direct import unavailable"))? = Some(Pending {
        id: id.clone(),
        request: Some(request),
        receiver_verified,
        reply,
    });
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let result = tokio::select! {
        result = tokio::time::timeout(REQUEST_TIMEOUT, response) => result.ok().and_then(|reply| reply.ok()),
        _ = stream.read_u8() => None,
    };
    if let Ok(mut pending) = state.0.lock() {
        if pending.as_ref().is_some_and(|value| value.id == id) {
            *pending = None;
        }
    }
    if let Some(Delivery { package, written }) = result {
        if receiver_verified
            && !peer
                .as_ref()
                .zip(RECEIVER_REQUIREMENT)
                .is_some_and(|(peer, requirement)| peer.satisfies(requirement))
        {
            return Err(io::Error::other("Direct import receiver identity changed"));
        }
        tokio::time::timeout(Duration::from_secs(3), async {
            stream.write_u32(package.len() as u32).await?;
            stream.write_all(package.as_bytes()).await
        })
        .await??;
        let _ = written.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn vault_link_mailspring(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DirectImport>,
) -> Result<(), String> {
    const UNAVAILABLE: &str = "Open the Mailspring preview and try again.";
    if window.label() != "main" || !vault::vault_session_active(app.state())? {
        return Err("Unlock MailPort to link an email app.".into());
    }
    if state.0.lock().map_err(|_| UNAVAILABLE)?.is_some() {
        return Ok(());
    }
    let directory = app.path().app_data_dir().map_err(|_| UNAVAILABLE)?;
    let uid = fs::metadata(&directory).map_err(|_| UNAVAILABLE)?.uid();
    let handshake = async {
        let mut socket = UnixStream::connect(directory.join(LINK_ENDPOINT)).await?;
        if socket.peer_cred()?.uid() != uid
            || RECEIVER_REQUIREMENT.is_some_and(|requirement| {
                !PeerToken::read(&socket).is_some_and(|peer| peer.satisfies(requirement))
            })
        {
            return Err(io::Error::other("Untrusted Mailspring link"));
        }
        socket.write_all(LINK_REQUEST).await?;
        let mut reply = [0; LINK_REPLY.len()];
        socket.read_exact(&mut reply).await?;
        if reply != LINK_REPLY {
            return Err(io::Error::other("Invalid Mailspring link response"));
        }
        Ok::<_, io::Error>(())
    };
    tokio::time::timeout(Duration::from_secs(3), handshake)
        .await
        .map_err(|_| UNAVAILABLE)?
        .map_err(|_| UNAVAILABLE)?;

    // The invitation contains no account data. Wait for the receiver's
    // separate, expiring encrypted-transfer request before showing approval.
    tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            if state.0.lock().map_err(|_| UNAVAILABLE)?.is_some() {
                return Ok::<_, &str>(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .map_err(|_| "Mailspring did not request an import. Try again.")??;
    Ok(())
}

#[tauri::command]
pub fn vault_direct_request(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DirectImport>,
) -> Option<DirectRequest> {
    if window.label() != "main" {
        return None;
    }
    let (id, receiver_verified) = {
        let pending = state.0.lock().ok()?;
        let pending = pending.as_ref()?;
        (pending.id.clone(), pending.receiver_verified)
    };
    Some(DirectRequest {
        id,
        accounts: vault::direct_account_summaries(&app),
        receiver_verified,
    })
}

#[tauri::command]
pub fn vault_direct_cancel(window: WebviewWindow, state: State<'_, DirectImport>, id: String) {
    if window.label() != "main" {
        return;
    }
    if let Ok(mut pending) = state.0.lock() {
        if pending.as_ref().is_some_and(|request| request.id == id) {
            *pending = None;
        }
    }
}

#[tauri::command]
pub async fn vault_direct_approve(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    ids: Vec<String>,
    verified_code: String,
) -> Result<String, String> {
    const CLOSED: &str = "The import request has closed. Start again in Mailspring.";
    if window.label() != "main" {
        return Err(CLOSED.into());
    }
    let state = app.state::<DirectImport>();
    let request = {
        let mut pending = state.0.lock().map_err(|_| CLOSED)?;
        let pending = pending
            .as_mut()
            .filter(|pending| pending.id == id)
            .ok_or(CLOSED)?;
        pending.take_verified_request(&verified_code)?
    };
    let package = vault::approve_direct_accounts(app.clone(), ids, request).await;
    let pending = {
        let mut pending = state.0.lock().map_err(|_| CLOSED)?;
        if !pending.as_ref().is_some_and(|request| request.id == id) {
            return Err(CLOSED.into());
        }
        pending.take().ok_or(CLOSED)?
    };
    let package = package?;
    let code = package_code(&package);
    let (written, delivery) = oneshot::channel();
    pending
        .reply
        .send(Delivery { package, written })
        .map_err(|_| CLOSED)?;
    delivery.await.map_err(|_| CLOSED)?;
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wrong_code_leaves_the_request_pending_and_a_match_consumes_it() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let request = ImportRequest::parse(
            &serde_json::json!({
                "format": "mailport-import-request",
                "version": 1,
                "requestId": "AAAAAAAAAAAAAAAAAAAAAA==",
                "clientName": "Mailspring",
                "expiresAt": now + 60,
                "publicKey": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="
            })
            .to_string(),
        )
        .unwrap();
        let code = request.verification_code();
        let (reply, _) = oneshot::channel();
        let mut pending = Pending {
            id: "test".into(),
            request: Some(request),
            receiver_verified: false,
            reply,
        };
        assert!(pending.take_verified_request(&format!("{code}0")).is_err());
        assert!(pending
            .take_verified_request(&code.to_ascii_lowercase())
            .is_ok());
        assert!(pending.take_verified_request(&code).is_err());
    }
}
