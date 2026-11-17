# Changelog

Every published version of Pop-out window for Claude. Each one has a git tag and a GitHub release.

## v0.6.0 (2026-11-17)
- The bar no longer stays invisible after the Mac sleeps: after sleep, a screen lock or a display change, its window is
  built again the next time you open it, and the Quick chat is put back.
- Menu bar ✳ > **Reset window** builds the window again by hand, without quitting.
- Window events (never chat text) are written to `bar.log` next to the config file.
- `make-signing-cert.sh` makes a local signing certificate, so Screen Recording stays granted after a rebuild.
- The window is a little more transparent.

## v0.5.0 (2026-11-15)
- Paste, copy, cut, select all and undo work in both Quick and Claude.ai mode.
- The window now sits just under input-method candidate windows, so they are no longer covered.
- Quick starts a new chat when the bar is opened 20 minutes after the last message (`idleNewChatMinutes`).

## v0.4.0 (2026-11-11)
- The window is a non-activating panel: it always opens on the current desktop, including over full-screen apps, and
  focus returns to your app when it hides.

## v0.3.0 (2026-11-10)
- The window is registered on every Space before it is shown, to stop the hotkey switching to a full-screen app's Space.

## v0.2.0 (2026-11-10)
- The window appears reliably when the hotkey is pressed.

## v0.1.0 (2026-11-09)
- First release: a floating, always-on-top chat window for Claude on macOS, with a fast Claude Code mode and a Claude.ai
  panel whose chats sync.
