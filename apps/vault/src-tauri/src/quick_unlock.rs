use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::Zeroizing;

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub touch_id: bool,
    pub one_password: Option<String>,
}

pub fn load(vault: &Path) -> Preferences {
    let path = vault.with_file_name("quick-unlock.json");
    mailport_core::read_encrypted(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(vault: &Path, preferences: &Preferences) -> Result<(), String> {
    let data =
        serde_json::to_string(preferences).map_err(|_| "Could not encode unlock settings.")?;
    mailport_core::write_encrypted(&vault.with_file_name("quick-unlock.json"), &data)
        .map_err(|error| error.to_owned())
}

pub fn valid_reference(reference: &str) -> bool {
    reference.len() <= 512
        && !reference.contains(['?', '#'])
        && !reference.chars().any(char::is_control)
        && reference.strip_prefix("op://").is_some_and(|path| {
            let parts: Vec<_> = path.split('/').collect();
            (3..=4).contains(&parts.len()) && parts.iter().all(|part| !part.trim().is_empty())
        })
}

#[cfg(target_os = "macos")]
pub use mac::{delete_touch_id, read_touch_id, store_touch_id, touch_id_available};

#[cfg(target_os = "macos")]
fn op_path() -> Option<&'static Path> {
    ["/opt/homebrew/bin/op", "/usr/local/bin/op"]
        .into_iter()
        .map(Path::new)
        .find(|path| path.is_file())
}

pub fn one_password_available() -> bool {
    #[cfg(target_os = "macos")]
    return op_path().is_some();
    #[cfg(not(target_os = "macos"))]
    false
}

pub fn read_one_password(reference: &str) -> Result<Zeroizing<String>, String> {
    if !valid_reference(reference) {
        return Err("Enter a 1Password secret reference for the password field, such as op://Vault/Item/password.".into());
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        let executable = op_path().ok_or("Install the 1Password CLI to use this option.")?;
        let mut command = Command::new(executable);
        command
            .env_clear()
            .env("OP_BIOMETRIC_UNLOCK_ENABLED", "true")
            .env("PATH", "/usr/bin:/bin")
            .args(["read", "--cache=false", "--no-newline", reference])
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        if let Some(home) = std::env::var_os("HOME") {
            command.env("HOME", home);
        }
        let mut output = command
            .output()
            .map_err(|_| "Could not start the 1Password CLI.")?;
        let bytes = Zeroizing::new(std::mem::take(&mut output.stdout));
        if !output.status.success() {
            return Err("1Password did not return the password. Open 1Password, enable its CLI integration, and check the item reference.".into());
        }
        return decode_password(&bytes);
    }
    #[cfg(not(target_os = "macos"))]
    Err("1Password quick unlock is available on macOS.".into())
}

#[cfg(target_os = "macos")]
fn decode_password(bytes: &[u8]) -> Result<Zeroizing<String>, String> {
    let password =
        std::str::from_utf8(bytes).map_err(|_| "The stored passphrase is not valid text.")?;
    mailport_core::validate_password(password)
        .map_err(|_| "The stored passphrase cannot unlock this vault.")?;
    Ok(Zeroizing::new(password.to_owned()))
}

#[cfg(not(target_os = "macos"))]
pub fn touch_id_available() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn read_touch_id() -> Result<Zeroizing<String>, String> {
    Err("Touch ID is available on macOS.".into())
}

#[cfg(not(target_os = "macos"))]
pub fn store_touch_id(_: &str) -> Result<(), String> {
    Err("Touch ID is available on macOS.".into())
}

#[cfg(not(target_os = "macos"))]
pub fn delete_touch_id() -> Result<(), String> {
    Err("Touch ID is available on macOS.".into())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use core_foundation::{
        base::{CFType, TCFType},
        boolean::CFBoolean,
        data::CFData,
        dictionary::CFDictionary,
        string::CFString,
    };
    use objc2::{
        msg_send,
        rc::Retained,
        runtime::{AnyClass, AnyObject, Bool},
    };
    use security_framework_sys::{access_control::*, item::*, keychain_item::*};
    use std::ptr::{null, null_mut};

    #[link(name = "LocalAuthentication", kind = "framework")]
    extern "C" {}
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecUseOperationPrompt: core_foundation::string::CFStringRef;
    }

    pub fn touch_id_available() -> bool {
        let Some(class) = AnyClass::get(c"LAContext") else {
            return false;
        };
        let context: Retained<AnyObject> = unsafe { msg_send![class, new] };
        let mut error: *mut AnyObject = null_mut();
        // Device owner authentication with biometrics, excluding the login password.
        let result: Bool =
            unsafe { msg_send![&*context, canEvaluatePolicy: 1_isize, error: &mut error] };
        result.as_bool()
    }

    fn query() -> Vec<(CFString, CFType)> {
        unsafe {
            vec![
                (
                    CFString::wrap_under_get_rule(kSecClass),
                    CFString::wrap_under_get_rule(kSecClassGenericPassword).as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrService),
                    CFString::new("org.mailport.vault.quick-unlock").as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccount),
                    CFString::new("master-passphrase").as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecUseDataProtectionKeychain),
                    CFBoolean::true_value().as_CFType(),
                ),
            ]
        }
    }

    pub fn store_touch_id(password: &str) -> Result<(), String> {
        if !touch_id_available() {
            return Err("Set up Touch ID in System Settings first.".into());
        }
        let access = unsafe {
            SecAccessControlCreateWithFlags(
                null(),
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly.cast(),
                kSecAccessControlBiometryCurrentSet,
                null_mut(),
            )
        };
        if access.is_null() {
            return Err("Could not create Touch ID protection.".into());
        }
        let mut properties = query();
        unsafe {
            properties.push((
                CFString::wrap_under_get_rule(kSecAttrAccessControl),
                CFType::wrap_under_create_rule(access.cast()),
            ));
            properties.push((
                CFString::wrap_under_get_rule(kSecValueData),
                CFData::from_buffer(password.as_bytes()).as_CFType(),
            ));
        }
        let item = CFDictionary::from_CFType_pairs(&properties);
        let status = unsafe { SecItemAdd(item.as_concrete_TypeRef(), null_mut()) };
        match status {
            0 => Ok(()),
            -25299 => Err(
                "A Touch ID entry already exists. Remove it in MailPort before enabling it again."
                    .into(),
            ),
            -34018 => Err(
                "The macOS Keychain requires a signed MailPort build with Keychain access for Touch ID.".into(),
            ),
            _ => Err(format!(
                "Could not save Touch ID unlock in Keychain (macOS error {status})."
            )),
        }
    }

    pub fn read_touch_id() -> Result<Zeroizing<String>, String> {
        let mut properties = query();
        unsafe {
            properties.push((
                CFString::wrap_under_get_rule(kSecReturnData),
                CFBoolean::true_value().as_CFType(),
            ));
            properties.push((
                CFString::wrap_under_get_rule(kSecUseOperationPrompt),
                CFString::new("Unlock MailPort Vault").as_CFType(),
            ));
        }
        let query = CFDictionary::from_CFType_pairs(&properties);
        let mut result = null();
        let status = unsafe { SecItemCopyMatching(query.as_concrete_TypeRef(), &mut result) };
        if status != 0 || result.is_null() {
            return Err(
                "Touch ID did not unlock the vault. Use your master passphrase if needed.".into(),
            );
        }
        let data = unsafe { CFType::wrap_under_create_rule(result) }
            .downcast_into::<CFData>()
            .ok_or("Could not read the Keychain entry.")?;
        decode_password(data.bytes())
    }

    pub fn delete_touch_id() -> Result<(), String> {
        let query = CFDictionary::from_CFType_pairs(&query());
        match unsafe { SecItemDelete(query.as_concrete_TypeRef()) } {
            0 | -25300 => Ok(()),
            status => Err(format!(
                "Could not remove Touch ID unlock from Keychain (macOS error {status})."
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::valid_reference;

    #[test]
    fn accepts_field_references_only() {
        assert!(valid_reference("op://Personal/MailPort/password"));
        assert!(valid_reference("op://Personal/MailPort/Fields/passphrase"));
        for invalid in [
            "password",
            "op://Personal/MailPort",
            "op://Personal//password",
            "op://Personal/MailPort/password?attribute=otp",
            "op://Personal/MailPort/pass\nword",
        ] {
            assert!(!valid_reference(invalid));
        }
    }
}
