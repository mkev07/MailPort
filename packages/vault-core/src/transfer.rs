use crate::{decode, validate_accounts, Account, PayloadData, Result, MAX_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use hpke::{
    aead::AesGcm256, kdf::HkdfSha256, kem::X25519HkdfSha256, Deserializable, Kem, OpModeS,
    Serializable,
};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

const REQUEST_MAX_BYTES: usize = 4096;
const REQUEST_FORMAT: &str = "mailport-import-request";
const PACKAGE_FORMAT: &str = "mailport-transfer";
const INVALID_REQUEST: &str = "Open the .mailportrequest file from your email app.";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportRequest {
    format: String,
    version: u8,
    request_id: String,
    pub client_name: String,
    pub expires_at: u64,
    public_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<'a> {
    format: &'static str,
    version: u8,
    request_id: &'a str,
    enc: String,
    ciphertext: String,
}

fn code(digest: &[u8]) -> String {
    digest[..8]
        .chunks_exact(2)
        .map(|pair| format!("{:02X}{:02X}", pair[0], pair[1]))
        .collect::<Vec<_>>()
        .join("-")
}

pub fn package_code(package: &str) -> String {
    code(&Sha256::digest(package.as_bytes()))
}

impl ImportRequest {
    pub fn read(path: &Path) -> Result<(Self, String)> {
        let file = File::open(path).map_err(|_| INVALID_REQUEST)?;
        let mut bytes = Vec::new();
        file.take((REQUEST_MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| INVALID_REQUEST)?;
        let text = String::from_utf8(bytes).map_err(|_| INVALID_REQUEST)?;
        Ok((Self::parse(&text)?, text))
    }

    pub fn parse(text: &str) -> Result<Self> {
        if text.len() > REQUEST_MAX_BYTES {
            return Err(INVALID_REQUEST);
        }
        let request: Self = serde_json::from_str(text).map_err(|_| INVALID_REQUEST)?;
        let valid_name = !request.client_name.is_empty()
            && request.client_name.len() <= 80
            && request.client_name.trim() == request.client_name
            && request
                .client_name
                .bytes()
                .all(|b| (b' '..=b'~').contains(&b));
        if request.format != REQUEST_FORMAT
            || request.version != 1
            || !valid_name
            || decode(&request.request_id)
                .map_err(|_| INVALID_REQUEST)?
                .len()
                != 16
            || decode(&request.public_key)
                .map_err(|_| INVALID_REQUEST)?
                .len()
                != 32
        {
            return Err(INVALID_REQUEST);
        }
        request.check_deadline()?;
        Ok(request)
    }

    fn check_deadline(&self) -> Result<()> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "Check your device's date and time.")?
            .as_secs();
        if self.expires_at <= now {
            return Err("This request expired. Create a new request in the receiving client.");
        }
        if self.expires_at > now + 930 {
            return Err("The request expires too far in the future. Check both devices' clocks.");
        }
        Ok(())
    }

    fn digest(&self) -> [u8; 32] {
        Sha256::digest(format!(
            "{REQUEST_FORMAT}\n1\n{}\n{}\n{}\n{}",
            self.request_id, self.expires_at, self.client_name, self.public_key
        ))
        .into()
    }

    pub fn verification_code(&self) -> String {
        code(&self.digest())
    }

    pub fn seal(&self, accounts: &[Account]) -> Result<String> {
        self.check_deadline()?;
        validate_accounts(accounts)?;
        if accounts.is_empty() {
            return Err("Select at least one account to export.");
        }
        let public_key =
            <X25519HkdfSha256 as Kem>::PublicKey::from_bytes(&decode(&self.public_key)?)
                .map_err(|_| INVALID_REQUEST)?;
        let info = [b"MailPort:transfer:1:".as_slice(), &self.digest()].concat();
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&PayloadData {
                accounts: accounts.to_vec(),
            })
            .map_err(|_| "Could not prepare the MailPort package.")?,
        );
        if plaintext.len() > MAX_BYTES * 3 / 4 {
            return Err("The selected accounts exceed the MailPort package size limit.");
        }
        let (enc, mut sender) = hpke::setup_sender::<AesGcm256, HkdfSha256, X25519HkdfSha256, _>(
            &OpModeS::Base,
            &public_key,
            &info,
            &mut OsRng,
        )
        .map_err(|_| INVALID_REQUEST)?;
        let ciphertext = sender
            .seal(&plaintext, b"")
            .map_err(|_| "Could not encrypt the MailPort package.")?;
        let package = serde_json::to_string(&Envelope {
            format: PACKAGE_FORMAT,
            version: 1,
            request_id: &self.request_id,
            enc: STANDARD.encode(enc.to_bytes()),
            ciphertext: STANDARD.encode(ciphertext),
        })
        .map_err(|_| "Could not prepare the MailPort package.")?;
        if package.len() > MAX_BYTES {
            return Err("The selected accounts exceed the MailPort package size limit.");
        }
        Ok(package)
    }
}
