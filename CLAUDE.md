# Pop-out window for Claude: project notes for Claude Code

A floating, always-on-top chat window for Claude on macOS, built with Electron.
It has two engines, switched at the top left and saved as `engine`. **Quick** runs `claude -p` (headless Claude Code) with the local login, so there is no API key. **Claude.ai** (`web`) shows the real claude.ai site in the window, so chats sync with the Claude app and phone.

## Run, test, build
- `npm install` then `npm start`: run from Terminal (dev).
- `npm test`: runner, markdown, handoff, chats, claudeweb and find tests. Plain Node; `claudeweb` needs `electron` to be installed but does not launch it.
- `npm run build-app` (or double-click `Build App.command`): builds `/Applications/Claude Bar.app` (no Dock icon, no Terminal), ad-hoc signed.
- Before rebuilding, quit the running copy (menu bar ✳ > Quit, or `pkill -f "Claude Bar"`). The app is single-instance, so an old copy silently blocks a new one.
- Config lives at `~/Library/Application Support/claude-chatbar/config.json`. `configVersion` drives one-off migrations in `loadConfig()`; bump it when changing defaults people already have saved.

## Files
- `main.js`: window, hotkey (default Option+Shift+Space), tray, window modes, IPC, always-on-top logic, handoff.
- `claude.js`: spawns `claude -p --output-format stream-json --include-partial-messages --system-prompt ... --disable-slash-commands`, plus `--tools WebSearch,WebFetch --allowedTools ...` (or `--tools ""`), and `--strict-mcp-config` unless connectors are on; resumes with `--resume <session>`; images and PDFs go via `--input-format stream-json`; reports usage from `rate_limit_event`.
- `claudeweb.js`: the Claude.ai panel (a `WebContentsView` in partition `persist:claudeai`, inset below the title row). Allows only Claude, Anthropic and sign-in hosts; other links open outside. Starts chats with `/new?q=`, then presses Enter once the box holds the text.
- `handoff.js`: builds the transcript for "⋯ > Move to a Claude.ai chat" (put in the panel's text box, not sent automatically); also reused as the text context when a chat must restart in a new session.
- `chats.js`: saved chat history, one JSON file per chat in `userData/chats` (`{id, sessionId, title, created, updated, messages}`; messages keep text, image count and the reply `uuid`, never image data).
- `preload.js`: the only bridge between page and main.
- `renderer/`: `index.html`, `style.css`, `renderer.js` (UI), `markdown.js` (safe Markdown + KaTeX), `widget.html` (sandbox for interactive views), `vendor/katex` (vendored, works offline). `logo.png` is optional and not shipped.
- `build-app.sh`, `Build App.command`, `build/info.plist` (LSUIElement = no Dock icon).

## Behavior decisions already made
- Small bar first; after the first message it becomes a FIXED-size chat window (`chatHeight` 520). It never grows with the conversation; only dragging changes it. Size is remembered. "New" returns to the small bar.
- The window reappears where it was hidden (`lastBounds`).
- Half-transparent using native vibrancy; `prefers-reduced-transparency` makes it solid.
- Claude.ai sending: `?q=` up to 6,000 encoded characters, otherwise `execCommand('insertText')` into the box. Enter is pressed once more only if the same text is still in the box after 2.5 s. With the screen locked (window cannot take focus) Enter on the first page of a new panel was lost; with the window focused it worked. If that happens the text simply stays in the box.
- Quick replaces Claude Code's prompt with `--system-prompt` (`DEFAULT_PROMPT`, date, About you, web and connector notes). Measured for one short message: about 61,000 tokens of context before, under 1,000 after with no tools.
- Claude.ai mode never reads the Claude app's login or calls private claude.ai APIs; it is only the site in a panel, signed in by the person using it. Do not change this. Sign-in guidance is "Continue with email": Google refuses or fails in embedded windows, and the user agent is deliberately not faked.
- Connectors are read-only: `CONNECTOR_READ` is pre-approved, `CONNECTOR_WRITE` is denied, and anything unlisted is refused because `-p` cannot prompt.
- Popovers in the small bar grow the window upward while open; in Claude.ai mode there are none, because the native panel would cover them.
- `applyTheme()` reads only `userThemeMode` from the Claude app's config. Fonts load from `/Applications/Claude.app` by `file:` URL and are never copied into this project.
- Plan mode strips `ANTHROPIC_API_KEY` from the environment on purpose, so the app can never bill the API by accident. `authMode: "apikey"` is the opt-in alternative.
- Claude gets no file or shell tools. Web search (`webSearch`, default true, the globe by the text box) allows only `WebSearch` and `WebFetch`, pre-approved with `--allowedTools` so `-p` never waits for a permission prompt; `WEB_PROMPT` in `claude.js` says when to search and to cite links. Tool-use blocks become `onStatus` events, and text blocks before and after a search are joined with a blank line.
- Sessions run with cwd `userData/Claude Bar` (not `os.tmpdir()`), so they are in one fixed Claude Code project.
- Retry/Edit: `--resume <sid> --resume-session-at <uuid of the previous reply> --fork-session`. `--resume-session-at` is a hidden CLI flag (checked on Claude Code 2.1.319: forks keep message uuids and drop later turns). With no earlier reply, or no uuid, the app starts a new session and sends the earlier turns as text. Same fallback when `--resume` says "No conversation found".
- "⋯ > Continue in Claude app (Code tab)" opens `claude://resume?session=<sid>`; the Claude app imports the CLI session into its Code tab.
- Finding `claude` (`searchClaude` in `claude.js`): an app opened from Finder has almost no PATH, and `zsh -l` does not read `.zshrc`, where nvm is set up. So it checks known folders, every nvm version (newest first), then `-lc` and `-ilc` shells. Test this with `env -i`; an app started by `open` from a Terminal inherits PATH and hides the problem.
- Copy goes through the main process (`clipboard.writeText`); reply Copy keeps the Markdown/LaTeX and replaces widget fences with `[interactive view]`.
- Math is LaTeX rendered with KaTeX; the system prompt (see `DEFAULT_PROMPT` in `main.js`) asks for `$...$` / `$$...$$`.
- Interactive views: Claude outputs one self-contained HTML document in a ```widget fence. It is mounted only when the message is complete, inside `<iframe sandbox="allow-scripts" src="widget.html">`. widget.html has its own CSP (no network) and receives the HTML by postMessage. Height is measured from `document.body.scrollHeight` (using documentElement causes a growth feedback loop).
- Always on top: level `screen-saver` + `levelBoost` (default and max 2147482631, so level 2147483631 = kCGMaximumWindowLevel, the highest macOS allows), applied AFTER `setVisibleOnAllWorkspaces` (that call can reset the level on macOS), re-asserted on show/blur and by a 1 s timer using `moveTop()`.
- Closing the window only hides it (it is destroyed only on quit); `showBar()` recreates it if it ever is destroyed.

## Things deliberately NOT done
- No special handling to appear over exam lockdown/proctoring browsers, and nothing for the macOS lock screen (not possible, and not something to work around).

## Ideas / open items
- Verify on a real Mac: staying above other apps' pop-out windows; the ↗ deep link to `claude://claude.ai/chat/<id>`; the screenshot hotkey pasting into the Claude.ai panel; "Continue in Claude app (Code tab)".
- Thinking blocks are rendered if Claude Code streams them, but none appeared with Sonnet at high effort on 2.1.319.
- Custom app icon.
- Spaces: a hidden window was repeatedly found registered on only one Space instead of all of them. Any app activation on show (`win.show()` on a normal window, `app.show()`, `app.focus`) then made macOS switch to that Space; re-registering first was not enough. Fix: the window is `type: 'panel'` (a non-activating NSPanel), `showBar()` never activates the app, and `hideBar()` does not call `app.hide()`. Confirmed on a real Mac, also over full-screen browsers. Do not reintroduce app activation. Why the registration collapses is unknown.

## Testing the Claude.ai panel
Never point an unpackaged Electron run (or any harness) at the real `userData`. Cookies are encrypted with a Keychain key tied to the app's name, so a run named "Electron" sees the panel as signed out and the site then replaces the stored login, which signs the panel out. Test against a fake local page by passing `base` to `createPane`. The `?q=` route has been used successfully on the real signed-in site. Typing long text with `execCommand('insertText')` and pasting a screenshot have only run against the fake page.

## Testing without a Mac
Electron runs headless on Linux: `xvfb-run -a electron --no-sandbox main.js`. A fake `claude` script (set `claudePath` in the config) can emit canned `stream-json` to exercise the UI, widgets and window sizing. macOS-only behavior (vibrancy, window levels, Dock hiding) cannot be tested that way.
