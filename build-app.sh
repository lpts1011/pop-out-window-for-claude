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
  --ignore='^/dist' --ignore='^/test' --ignore='^/build-app.sh'
APP="dist/Claude Bar-darwin-$ARCH/Claude Bar.app"
# ad-hoc sign so it launches on Apple Silicon, and clear the download quarantine flag
codesign --force --deep --sign - "$APP" 2>/dev/null || true
xattr -cr "$APP" 2>/dev/null || true
rm -rf "/Applications/Claude Bar.app"
cp -R "$APP" /Applications/
rm -rf dist   # avoid a second "Claude Bar" showing up in Launchpad
echo "Installed: /Applications/Claude Bar.app"
open "/Applications/Claude Bar.app"
