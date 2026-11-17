#!/bin/bash
# Builds "Claude Bar.app" (no Dock icon, no Terminal window) and installs it to /Applications.
set -e
cd "$(dirname "$0")"
[ -d node_modules/electron ] || npm install
case "$(uname -m)" in x86_64) ARCH=x64 ;; *) ARCH=arm64 ;; esac
npx --yes @electron/packager . "Claude Bar" \
  --platform=darwin --arch="$ARCH" --out=dist --overwrite \
  --app-bundle-id=local.claude-chatbar \
  --extend-info=build/info.plist \
  --ignore='^/dist' --ignore='^/test' --ignore='^/build-app.sh' --ignore='^/make-signing-cert.sh'
APP="dist/Claude Bar-darwin-$ARCH/Claude Bar.app"
# Sign so it launches on Apple Silicon, and clear the download quarantine flag. With the
# certificate from make-signing-cert.sh the signature is the same for every build, so macOS keeps
# the permissions you granted (Screen Recording); without it the build is ad-hoc signed and macOS
# treats each build as a new app.
xattr -cr "$APP" 2>/dev/null || true
KEYCHAIN="$HOME/Library/Keychains/claude-bar-signing.keychain-db"
SIGNED=""
if [ -f "$KEYCHAIN" ]; then
  security unlock-keychain -p claude-bar "$KEYCHAIN" 2>/dev/null || true
  if codesign --force --deep --keychain "$KEYCHAIN" --sign "Claude Bar Local Signing" "$APP" 2>/dev/null; then
    SIGNED=yes
    echo "Signed with: Claude Bar Local Signing"
  fi
fi
if [ -z "$SIGNED" ]; then
  codesign --force --deep --sign - "$APP" 2>/dev/null || true
  echo "Ad-hoc signed (run ./make-signing-cert.sh once to keep permissions between builds)"
fi
rm -rf "/Applications/Claude Bar.app"
cp -R "$APP" /Applications/
rm -rf dist   # avoid a second "Claude Bar" showing up in Launchpad
echo "Installed: /Applications/Claude Bar.app"
open "/Applications/Claude Bar.app"
