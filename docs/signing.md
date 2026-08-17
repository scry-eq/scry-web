# Signing the desktop builds

Releases are unsigned by default, so macOS reports an unidentified developer and
Windows SmartScreen warns. Signing turns on by itself once the credentials exist
— the release workflow reads them and skips signing when they are absent, so
nothing needs editing to enable it.

**macOS** — needs the Apple Developer Program ($99/yr) and a Developer ID
Application certificate exported as a `.p12`.

| secret | value |
| --- | --- |
| `MAC_CSC_LINK` | the `.p12`, base64-encoded (`base64 -i cert.p12`) |
| `MAC_CSC_KEY_PASSWORD` | its export password |
| `APPLE_ID` | the Apple ID that owns the certificate |
| `APPLE_APP_SPECIFIC_PASSWORD` | an app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | the 10-character team id |

The first two sign; the last three notarize. Signing WITHOUT notarizing does not
clear Gatekeeper on a downloaded dmg — the build logs say so when only half the
credentials are present.

**Windows** — OV certificates now require the key on hardware, so a `.pfx` in a
secret is no longer issuable. [Azure Trusted
Signing](https://learn.microsoft.com/azure/trusted-signing/) (~$10/mo) is the
CI-friendly route.

| secret / var | value |
| --- | --- |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | service principal with the Trusted Signing Certificate Profile Signer role |
| `AZURE_PUBLISHER_NAME` (var) | must match the certificate's subject exactly |
| `AZURE_ENDPOINT` (var) | e.g. `https://eus.codesigning.azure.net/` |
| `AZURE_CODE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE` (vars) | from the Azure resource |

Note SmartScreen still warns on a signed build until it accrues download
reputation; an EV certificate is what skips that.

**Until then**, the warnings are cleared by hand: on macOS
`xattr -d com.apple.quarantine /Applications/scry.app`, on Windows *More info →
Run anyway*. Linux AppImages are unaffected either way.
