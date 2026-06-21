# Apple Wallet Certificates

This directory holds the certificates required for Apple Wallet pass generation.
**NEVER commit these files to git** — they are already in .gitignore.

## Required files

- `signerCert.pem` — Pass Type ID certificate
- `signerKey.pem` — Private key for the certificate
- `wwdr.pem` — Apple WWDR intermediate certificate
- `apn_key.p8` — Apple Push Notifications key (for live pass updates)

## Setup Instructions

### 1. Apple Developer Account
Sign up at https://developer.apple.com ($99/year).

### 2. Create a Pass Type ID
1. Go to Certificates, Identifiers & Profiles → Identifiers → Pass Type IDs
2. Click + and register: `pass.mx.elgranribera.loyalty`

### 3. Generate the Pass Type ID certificate
1. Select your Pass Type ID → Create Certificate
2. Download the `.cer` file
3. Convert to PEM:
   ```bash
   openssl x509 -in certificate.cer -inform DER -out signerCert.pem -outform PEM
   ```

### 4. Export the private key
1. Open Keychain Access on macOS
2. Find the certificate, expand it, right-click the private key
3. Export as .p12
4. Convert to PEM:
   ```bash
   openssl pkcs12 -in key.p12 -nocerts -nodes -out signerKey.pem
   ```

### 5. Download WWDR certificate
```bash
curl -o AppleWWDRCAG4.cer https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer
openssl x509 -in AppleWWDRCAG4.cer -inform DER -out wwdr.pem -outform PEM
```

### 6. Apple Push Notifications key (optional — for live updates)
1. Certificates, Identifiers & Profiles → Keys → Create a key
2. Enable "Apple Push Notifications service (APNs)"
3. Download the `.p8` file and save as `apn_key.p8`
4. Note the Key ID and set `APPLE_APN_KEY_ID` in `.env.local`

### 7. Update pass.json
Edit `passes/apple/template/pass.json`:
- Replace `XXXXXXXXXX` in `teamIdentifier` with your Team ID
- Replace `pass.mx.elgranribera.loyalty` if you used a different ID

### 8. Add images
Add these images to `passes/apple/template/`:
- `icon.png` (29×29), `icon@2x.png` (58×58), `icon@3x.png` (87×87)
- `logo.png` (160×50), `logo@2x.png` (320×100)
- `strip.png` (375×123), `strip@2x.png` (750×246) — background image shown on card
