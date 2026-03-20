# macOS Signing Release Checklist

Use this before shipping another macOS desktop build.

## Why

Unsigned or un-notarized macOS downloads can be blocked by Gatekeeper with messages like:

- `Agent Workspace.app is damaged and can't be opened`
- `Agent Workspace.app is from an unidentified developer`

The GitHub Actions macOS workflow now expects proper Apple signing and notarization credentials for tag releases.

## GitHub Actions Secrets

Add these repository secrets before cutting the next macOS release.

Required:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`

Optional but recommended:

- `APPLE_SIGNING_IDENTITY`

Choose one notarization path.

App Store Connect API key path:

- `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_BASE64`

Apple ID path:

- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

## Secret Formats

`APPLE_CERTIFICATE`

- export the `Developer ID Application` certificate as a `.p12`
- base64-encode the file contents
- store the base64 string in the secret

`APPLE_CERTIFICATE_PASSWORD`

- password used when exporting the `.p12`

`APPLE_API_KEY_BASE64`

- base64-encode the `.p8` App Store Connect API key file

`APPLE_SIGNING_IDENTITY`

- optional override
- example: `Developer ID Application: Your Name (TEAMID)`

## Release Steps

1. Confirm the repo version is ready for release.
2. Confirm the macOS secrets above are present in GitHub Actions.
3. Push the release tag.
4. Wait for `.github/workflows/macos.yml` to finish.
5. Confirm the workflow passes the `Verify signed + notarized macOS bundle` step.
6. Confirm the uploaded macOS `.app` and `.dmg` came from that signed workflow run.

## What the Workflow Now Verifies

The release workflow now:

- imports the Apple certificate into a temporary keychain
- resolves the macOS signing identity
- passes notarization credentials into the Tauri build
- validates the built app with `codesign`
- checks Gatekeeper acceptance with `spctl`
- validates notarization stapling with `xcrun stapler validate`

If signing or notarization is not configured on a tag release, the macOS workflow fails before publishing assets.

## After Shipping

Test the released macOS artifact on a clean machine:

1. download the `.dmg` from GitHub Releases
2. move the app into `Applications`
3. launch it normally
4. confirm Gatekeeper does not show a damaged/unidentified warning

## Source Install Fallback

Until a signed macOS desktop release is published, direct users to:

```bash
git clone https://github.com/web3dev1337/agent-workspace.git
cd agent-workspace
npm install
npm start
```
