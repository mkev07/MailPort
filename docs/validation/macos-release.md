# macOS release candidate

The Apple Silicon candidate built from `50b273d` passed Apple notarization.
The archived app was extracted into a fresh directory and passed strict
signature verification, stapled-ticket validation, and Gatekeeper assessment
as a notarized Developer ID app. The ZIP and its SHA-256 digest were generated
locally. Fresh-install runtime acceptance and public distribution are pending.

Build from a clean, reviewed revision. Use the local Tauri build, a Developer
ID Application identity in the signing keychain, and an authenticated
`notarytool` Keychain profile. The application bundle uses the
`org.mailport.vault` identifier and is meant for direct distribution.

```sh
npm ci
npm run check
npm run check:rust
npm run check:compatibility
cargo test --locked -p mailport --lib
APPLE_SIGNING_IDENTITY="<Developer ID Application identity>" \
  npm run vault:build -- --bundles app
```

Verify the hardened runtime signature before submitting. The
`Authority=Developer ID Application` line and the `runtime` flag should
both be present in the output.

```sh
app="target/release/bundle/macos/MailPort Vault.app"
codesign --verify --deep --strict "$app"
codesign -dv --verbose=4 "$app" 2>&1
ditto -c -k --keepParent "$app" /tmp/MailPort-notary.zip
xcrun notarytool submit /tmp/MailPort-notary.zip \
  --keychain-profile "<profile>" --wait
xcrun stapler staple "$app"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=2 "$app"
```

After the signed bundle is stapled and accepted by Gatekeeper, archive it
again so the distribution copy includes the ticket. Keep the candidate and
its digest together. Verify on a separate account or machine using the
[synthetic desktop acceptance checks](../../apps/vault/README.md#manual-acceptance-with-synthetic-data).
Developer ID signing and notarization establish distribution integrity.
Touch ID unlock and transfer approval also need to be exercised with the
final app identity and entitlement configuration.
