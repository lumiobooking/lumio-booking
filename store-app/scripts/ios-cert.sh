#!/usr/bin/env bash
# The App Store signing certificate WITHOUT a Mac (Windows Git Bash, Linux, or
# the Claude workspace on your computer). Two steps, with the Apple website in
# between. Everything stays in store-app/.signing/ (never committed — see
# .gitignore). Keep that folder safe: the .key file IS the certificate.
#
#   bash scripts/ios-cert.sh csr  "Lumio Agency LLC" you@lumioagency.com
#        → .signing/dist.csr  — upload it at developer.apple.com → Certificates → +
#          → "Apple Distribution" → choose file → Download → distribution.cer
#   bash scripts/ios-cert.sh p12  ~/Downloads/distribution.cer
#        → .signing/dist.p12 + its password, and base64 text for the GitHub secrets
#          IOS_DIST_CERT_P12_BASE64 and IOS_DIST_CERT_PASSWORD
#   bash scripts/ios-cert.sh b64  ~/Downloads/Lumio_Booking_App_Store.mobileprovision
#        → base64 text of any file (the profile, the .p8 key, GoogleService-Info.plist)
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=.signing
mkdir -p "$DIR"
chmod 700 "$DIR" 2>/dev/null || true
b64() { if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0 "$1"; else base64 -i "$1" | tr -d '\n'; fi; }

case "${1:-}" in
  csr)
    ORG="${2:-Lumio Agency LLC}"; EMAIL="${3:-}"
    if [ -f "$DIR/dist.key" ]; then echo "$DIR/dist.key already exists — not replacing it."; else
      openssl genrsa -out "$DIR/dist.key" 2048 2>/dev/null; chmod 600 "$DIR/dist.key"; fi
    SUBJ="/CN=$ORG/O=$ORG/C=US"; [ -n "$EMAIL" ] && SUBJ="/emailAddress=$EMAIL$SUBJ"
    openssl req -new -key "$DIR/dist.key" -out "$DIR/dist.csr" -subj "$SUBJ"
    echo "OK: $DIR/dist.csr"
    echo "Next: developer.apple.com → Certificates, IDs & Profiles → Certificates → + → Apple Distribution"
    echo "      → upload $DIR/dist.csr → Download (distribution.cer) → run: bash scripts/ios-cert.sh p12 <path to distribution.cer>"
    ;;
  p12)
    CER="${2:?path to distribution.cer}"
    [ -f "$DIR/dist.key" ] || { echo "No $DIR/dist.key — run the csr step first (same computer)."; exit 1; }
    openssl x509 -inform DER -in "$CER" -out "$DIR/dist.pem" 2>/dev/null || openssl x509 -in "$CER" -out "$DIR/dist.pem"
    # The certificate must belong to OUR key.
    if [ "$(openssl x509 -noout -modulus -in "$DIR/dist.pem" | openssl md5)" != "$(openssl rsa -noout -modulus -in "$DIR/dist.key" 2>/dev/null | openssl md5)" ]; then
      echo "This certificate was not made from $DIR/dist.csr (different key)."; exit 1; fi
    PASS="$(openssl rand -hex 16)"
    # 3DES/SHA1: the macOS keychain cannot read the newer OpenSSL 3 default (AES) .p12.
    openssl pkcs12 -export -inkey "$DIR/dist.key" -in "$DIR/dist.pem" -out "$DIR/dist.p12" -passout "pass:$PASS" \
      -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -name "Apple Distribution: Lumio"
    printf '%s' "$PASS" > "$DIR/dist.p12.password.txt"
    b64 "$DIR/dist.p12" > "$DIR/IOS_DIST_CERT_P12_BASE64.txt"
    printf '%s' "$PASS" > "$DIR/IOS_DIST_CERT_PASSWORD.txt"
    echo "OK. GitHub → Settings → Secrets and variables → Actions → New repository secret:"
    echo "  IOS_DIST_CERT_P12_BASE64 = contents of $DIR/IOS_DIST_CERT_P12_BASE64.txt"
    echo "  IOS_DIST_CERT_PASSWORD   = contents of $DIR/IOS_DIST_CERT_PASSWORD.txt"
    echo "Expires: $(openssl x509 -noout -enddate -in "$DIR/dist.pem" | cut -d= -f2)"
    ;;
  b64)
    F="${2:?file}"; OUT="$DIR/$(basename "$F").base64.txt"
    b64 "$F" > "$OUT"; echo "OK: $OUT (paste its contents as the secret value)"
    ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
