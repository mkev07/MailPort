use core_foundation::{base::TCFType, data::CFData, dictionary::CFDictionary, string::CFString};
use security_framework_sys::code_signing::{
    kSecGuestAttributeAudit, SecCodeCheckValidity, SecCodeCopyGuestWithAttributes,
    SecRequirementCreateWithString,
};
use std::{mem::size_of_val, os::fd::AsRawFd, ptr};

pub(crate) struct PeerToken([u32; 8]);

impl PeerToken {
    pub(crate) fn read(socket: &impl AsRawFd) -> Option<Self> {
        // Darwin's audit_token_t contains eight unsigned 32-bit words.
        let mut token = [0u32; 8];
        let mut size = size_of_val(&token) as libc::socklen_t;
        let status = unsafe {
            libc::getsockopt(
                socket.as_raw_fd(),
                libc::SOL_LOCAL,
                libc::LOCAL_PEERTOKEN,
                token.as_mut_ptr().cast(),
                &mut size,
            )
        };
        (status == 0 && size as usize == size_of_val(&token)).then_some(Self(token))
    }

    pub(crate) fn satisfies(&self, requirement: &str) -> bool {
        let bytes = self.0.map(u32::to_ne_bytes).concat();
        let token = CFData::from_buffer(&bytes);
        let requirement = CFString::new(requirement);
        unsafe {
            let key = CFString::wrap_under_get_rule(kSecGuestAttributeAudit);
            let attributes = CFDictionary::from_CFType_pairs(&[(key, token)]);
            let mut code = ptr::null_mut();
            if SecCodeCopyGuestWithAttributes(
                ptr::null_mut(),
                attributes.as_concrete_TypeRef(),
                0,
                &mut code,
            ) != 0
                || code.is_null()
            {
                return false;
            }
            let mut parsed = ptr::null_mut();
            let valid =
                SecRequirementCreateWithString(requirement.as_concrete_TypeRef(), 0, &mut parsed)
                    == 0
                    && !parsed.is_null()
                    && SecCodeCheckValidity(code, 0, parsed) == 0;
            if !parsed.is_null() {
                core_foundation::base::CFRelease(parsed.cast());
            }
            core_foundation::base::CFRelease(code.cast());
            valid
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{os::unix::net::UnixStream, process::Command};

    #[test]
    fn socket_identity_matches_running_code_and_rejects_another_requirement() {
        let (peer, _other) = UnixStream::pair().expect("local socket pair");
        let identity = PeerToken::read(&peer).expect("kernel audit token for the test socket");
        let output = Command::new("/usr/bin/codesign")
            .args(["-d", "-r-"])
            .arg(std::env::current_exe().unwrap())
            .output()
            .unwrap();
        assert!(output.status.success());
        let output =
            String::from_utf8(output.stdout).unwrap() + &String::from_utf8_lossy(&output.stderr);
        let requirement = output
            .lines()
            .find_map(|line| line.trim_start_matches("# ").strip_prefix("designated => "))
            .unwrap();
        assert!(
            identity.satisfies(requirement),
            "the running test image must satisfy its own designated requirement"
        );
        assert!(!identity.satisfies(r#"identifier "org.mailport.untrusted-test-peer""#));
        assert!(!identity.satisfies("invalid requirement"));
    }
}
