#!/bin/bash
# Makes a signing certificate that stays the same between builds, so macOS keeps the permissions
# you gave Claude Bar (for example Screen Recording) after a rebuild. Run it once.
#
# The certificate is self-signed and lives in its own small keychain file. It is only used by
# build-app.sh on this Mac; it is not trusted by anyone else and cannot be used to share the app.
set -e
NAME="Claude Bar Local Signing"
KEYCHAIN="$HOME/Library/Keychains/claude-bar-signing.keychain-db"
PASS="claude-bar"   # not a secret: it only locks the file that holds this one certificate

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "Already there: $NAME"
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -subj "/CN=$NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null
# the older encryption is the one the macOS keychain can read
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -out "$TMP/cert.p12" -passout "pass:$PASS" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
[ -f "$KEYCHAIN" ] || security create-keychain -p "$PASS" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"            # no auto-lock
security unlock-keychain -p "$PASS" "$KEYCHAIN"
security import "$TMP/cert.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
# let codesign use the key without asking each time
security set-key-partition-list -S apple-tool:,apple: -s -k "$PASS" "$KEYCHAIN" >/dev/null
echo "Created: $NAME"
