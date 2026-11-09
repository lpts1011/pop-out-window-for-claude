#!/bin/bash
# Double-click this file in Finder to build and install "Claude Bar.app".
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
bash ./build-app.sh && echo "Done. You can close this window." || echo "Build failed. Copy the messages above and send them to Claude."
