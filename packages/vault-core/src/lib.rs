use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const MAX_BYTES: usize = 4 * 1024 * 1024;
const SUITE: &str = "scrypt-n32768-r8-p1-aes256gcm";
const AAD: &[u8] = b"MailPort:1:scrypt-n32768-r8-p1-aes256gcm";
pub type Result<T> = std::result::Result<T, &'static str>;

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Auth {
    Password {
        password: String,
    },
    #[serde(rename_all = "camelCase")]
    Oauth {
        provider_id: String,
    },
}
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct Server {
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub auth: Auth,
}
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub incoming: Server,
    pub outgoing: Server,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PayloadData {
    accounts: Vec<Account>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    format: String,
    version: u32,
    suite: String,
    salt: String,
    nonce: String,
    ciphertext: String,
    tag: String,
}

fn count(s: &str) -> usize {
    s.encode_utf16().count()
}
pub fn validate_password(password: &str) -> Result<()> {
    if count(password) < 12 || password.len() > 1024 {
        return Err("Use at least 12 characters and at most 1,024 UTF-8 bytes.");
    }
    Ok(())
}
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.as_bytes()[0].is_ascii_alphanumeric()
        && host.as_bytes()[host.len() - 1].is_ascii_alphanumeric()
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}
fn valid_email(email: &str) -> bool {
    static EMAIL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    count(email) <= 320 && EMAIL.get_or_init(|| regex::Regex::new(r"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$").expect("fixed email profile")).is_match(email)
}
fn valid_id(id: &str) -> bool {
    static UUID: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    UUID.get_or_init(|| regex::Regex::new(r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$").expect("fixed UUID profile")).is_match(id)
}
impl Server {
    fn validate(&self) -> Result<()> {
        if !valid_host(&self.host)
            || self.port == 0
            || !matches!(self.security.as_str(), "tls" | "starttls")
            || self.username.is_empty()
            || count(&self.username) > 320
        {
            return Err("Check the server, port, TLS setting and username.");
        }
        match &self.auth {
            Auth::Password { password } if password.is_empty() || count(password) > 4096 => {
                Err("Enter a password or app password (up to 4,096 characters).")
            }
            Auth::Oauth { provider_id } if provider_id.is_empty() || count(provider_id) > 128 => {
                Err("Enter an OAuth provider identifier (up to 128 characters).")
            }
            _ => Ok(()),
        }
    }
}
pub fn validate_accounts(accounts: &[Account]) -> Result<()> {
    if accounts.len() > 100 {
        return Err("A vault can contain up to 100 accounts.");
    }
    let mut ids = std::collections::HashSet::new();
    for account in accounts {
        if !valid_id(&account.id)
            || !ids.insert(&account.id)
            || !valid_email(&account.email)
            || count(&account.display_name) > 256
        {
            return Err("Check the email address, display name and unique account ID.");
        }
        account.incoming.validate()?;
        account.outgoing.validate()?;
    }
    Ok(())
}
fn derive(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    validate_password(password)?;
    let params = scrypt::Params::new(15, 8, 1, 32).map_err(|_| "Vault cryptography failed.")?;
    let mut key = Zeroizing::new([0u8; 32]);
    scrypt::scrypt(password.as_bytes(), salt, &params, key.as_mut())
        .map_err(|_| "Vault cryptography failed.")?;
    Ok(key)
}
fn decode(s: &str) -> Result<Vec<u8>> {
    let bytes = STANDARD
        .decode(s)
        .map_err(|_| "Invalid MailPort package.")?;
    if STANDARD.encode(&bytes) != s {
        return Err("Invalid MailPort package.");
    }
    Ok(bytes)
}
pub fn seal(accounts: &[Account], password: &str) -> Result<String> {
    validate_accounts(accounts)?;
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    getrandom::getrandom(&mut salt).map_err(|_| "Secure randomness is unavailable.")?;
    getrandom::getrandom(&mut nonce).map_err(|_| "Secure randomness is unavailable.")?;
    let key = derive(password, &salt)?;
    let plaintext = Zeroizing::new(
        serde_json::to_vec(&PayloadData {
            accounts: accounts.to_vec(),
        })
        .map_err(|_| "Could not encode vault.")?,
    );
    let cipher =
        Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "Vault cryptography failed.")?;
    let mut combined = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: AAD,
            },
        )
        .map_err(|_| "Vault cryptography failed.")?;
    let tag = combined.split_off(combined.len() - 16);
    let text = serde_json::to_string(&Envelope {
        format: "mailport-vault".into(),
        version: 1,
        suite: SUITE.into(),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(combined),
        tag: STANDARD.encode(tag),
    })
    .map_err(|_| "Could not encode vault.")?;
    if text.len() > MAX_BYTES {
        return Err("MailPort packages must be at most 4 MiB.");
    }
    Ok(text)
}
pub fn unlock(text: &str, password: &str) -> Result<Vec<Account>> {
    if text.len() > MAX_BYTES {
        return Err("MailPort packages must be at most 4 MiB.");
    }
    let envelope: Envelope = serde_json::from_str(text).map_err(|_| "Invalid MailPort package.")?;
    if envelope.format != "mailport-vault" || envelope.version != 1 || envelope.suite != SUITE {
        return Err("Unsupported MailPort format.");
    }
    let salt = decode(&envelope.salt)?;
    let nonce = decode(&envelope.nonce)?;
    let mut combined = decode(&envelope.ciphertext)?;
    let tag = decode(&envelope.tag)?;
    if salt.len() != 16 || nonce.len() != 12 || tag.len() != 16 || combined.is_empty() {
        return Err("Invalid MailPort package.");
    }
    combined.extend_from_slice(&tag);
    let key = derive(password, &salt)?;
    let cipher =
        Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| "Vault cryptography failed.")?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &combined,
                    aad: AAD,
                },
            )
            .map_err(|_| "Could not unlock. Check the password; the file may also be damaged.")?,
    );
    let payload: PayloadData =
        serde_json::from_slice(&plaintext).map_err(|_| "Invalid vault contents.")?;
    validate_accounts(&payload.accounts)?;
    Ok(payload.accounts)
}
pub fn read_encrypted(path: &Path) -> Result<String> {
    let file = fs::File::open(path).map_err(|_| "Could not read the encrypted file.")?;
    let mut contents = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut contents)
        .map_err(|_| "Could not read the encrypted file.")?;
    if contents.len() > MAX_BYTES {
        return Err("MailPort packages must be at most 4 MiB.");
    }
    String::from_utf8(contents).map_err(|_| "Invalid MailPort package.")
}
pub fn write_encrypted(path: &Path, text: &str) -> Result<()> {
    write_file(path, text, true)
}
pub fn write_new_encrypted(path: &Path, text: &str) -> Result<()> {
    write_file(path, text, false)
}
fn write_file(path: &Path, text: &str, replace: bool) -> Result<()> {
    if text.len() > MAX_BYTES {
        return Err("MailPort packages must be at most 4 MiB.");
    }
    let parent = path.parent().ok_or("Choose a valid destination.")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Could not create an encrypted file at this location.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Could not protect the encrypted file.")?;
    }
    file.write_all(text.as_bytes())
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "Could not save the encrypted file.")?;
    if replace {
        file.persist(path)
            .map_err(|_| "Could not finish saving the encrypted file.")?;
    } else {
        file.persist_noclobber(path)
            .map_err(|_| "A file already exists, or the encrypted file could not be saved.")?;
    }
    Ok(())
}
pub fn select_accounts(accounts: &[Account], ids: &[String]) -> Result<Vec<Account>> {
    let mut selected = Vec::new();
    let mut seen = std::collections::HashSet::new();
    if ids.is_empty() {
        return Err("Select at least one account.");
    }
    for id in ids {
        if !seen.insert(id) {
            return Err("Duplicate account selection.");
        }
        selected.push(
            accounts
                .iter()
                .find(|a| &a.id == id)
                .ok_or("An account is no longer available.")?
                .clone(),
        );
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn vector() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../docs/vectors/v1.json")).unwrap()
    }
    #[test]
    fn reads_node_known_answer_vector() {
        let v = vector();
        let accounts = unlock(&v["envelope"].to_string(), v["password"].as_str().unwrap()).unwrap();
        assert_eq!(serde_json::to_value(accounts).unwrap(), v["accounts"]);
    }
    #[test]
    fn encrypts_roundtrip_and_rejects_tampering() {
        let v = vector();
        let accounts: Vec<Account> = serde_json::from_value(v["accounts"].clone()).unwrap();
        let first = seal(&accounts, "a-test-password-123").unwrap();
        let second = seal(&accounts, "a-test-password-123").unwrap();
        assert_ne!(first, second);
        assert!(!first.contains("PUBLIC-FAKE-PASSWORD"));
        assert_eq!(unlock(&first, "a-test-password-123").unwrap().len(), 1);
        assert!(unlock(&first, "another-password-123").is_err());
        let mut e: serde_json::Value = serde_json::from_str(&first).unwrap();
        e["tag"] = serde_json::json!(STANDARD.encode([0u8; 16]));
        assert!(unlock(&e.to_string(), "a-test-password-123").is_err());
    }
    #[test]
    fn validates_selection_and_only_seals_selected_accounts() {
        let v = vector();
        let first: Account = serde_json::from_value(v["accounts"][0].clone()).unwrap();
        let mut second = first.clone();
        second.id = uuid::Uuid::new_v4().to_string();
        second.email = "second@example.com".into();
        let accounts = vec![first, second];
        let ids = vec![accounts[0].id.clone()];
        let selected = select_accounts(&accounts, &ids).unwrap();
        let text = seal(&selected, "transfer-password-123").unwrap();
        let imported = unlock(&text, "transfer-password-123").unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].id, ids[0]);
        assert!(select_accounts(&accounts, &[]).is_err());
        assert!(select_accounts(&accounts, &[ids[0].clone(), ids[0].clone()]).is_err());
        assert!(select_accounts(&accounts, &["unknown".into()]).is_err());
    }
    #[test]
    fn atomic_write_and_bounded_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.mailport");
        write_encrypted(&path, "first").unwrap();
        write_encrypted(&path, "second").unwrap();
        assert_eq!(read_encrypted(&path).unwrap(), "second");
        assert!(write_new_encrypted(&path, "must-not-overwrite").is_err());
        assert_eq!(read_encrypted(&path).unwrap(), "second");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(read_encrypted(&dir.path().join("missing")).is_err());
    }
    #[test]
    fn rejects_insecure_server_and_unknown_oauth_fields() {
        let v = vector();
        let mut a: Account = serde_json::from_value(v["accounts"][0].clone()).unwrap();
        a.incoming.security = "none".into();
        assert!(validate_accounts(&[a]).is_err());
        let mut value = v["accounts"][0].clone();
        value["outgoing"]["auth"]["refreshToken"] = "should-never-be-here".into();
        assert!(serde_json::from_value::<Account>(value).is_err());
    }
}
