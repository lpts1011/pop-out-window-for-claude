# Pop-out window for Claude

A floating, always-on-top chat window for Claude on macOS. Press a global hotkey anywhere, type, and the reply appears in
the same small window, above your other apps and full-screen spaces, until you press Esc.

> **Unofficial project.** This is an independent tool. It is not made, endorsed or supported by Anthropic. Read
> [Important notes](#important-notes) before you use it.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [First run](#first-run)
- [The two modes](#the-two-modes)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Using the window](#using-the-window)
- [Configuration](#configuration)
- [Important notes](#important-notes)
- [Where your data is stored](#where-your-data-is-stored)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Known limitations and untested areas](#known-limitations-and-untested-areas)
- [Development](#development)
- [License](#license)

## Features

- Global hotkey and a small bar that becomes a fixed-size chat window after your first message
- Two modes: **Quick** (a fast built-in chat through Claude Code) and **Claude.ai** (the real site, with chats that sync)
- Streaming Markdown, code blocks, tables and math typesetting with KaTeX
- Interactive views (sliders, graphs) in a locked-down sandbox with no network access
- Web search with cited sources
- Images, PDFs, text and code files, plus a screenshot hotkey
- Optional read-only access to the Gmail, Drive, Docs, Sheets and Slides you connected to your Claude account
- Copy, Retry, Edit, saved chat history, and plan usage display
- Model and effort picker
- Hand-off to a Claude.ai chat or to the Code tab of the Claude desktop app
- Follows the Claude app's light or dark setting and uses its fonts when it is installed

## Requirements

| Requirement | Notes |
| --- | --- |
| macOS | Apple Silicon or Intel. Window levels, vibrancy and Dock hiding are macOS features |
| [Node.js](https://nodejs.org) | A current LTS release. Used to install and build |
| [Claude Code](https://claude.com/claude-code) | The `claude` command, signed in. Needed for Quick mode |
| A Claude account | Quick mode uses your Claude Code login. Claude.ai mode uses your normal plan on the site |
| Claude desktop app (optional) | Only for its fonts, its theme setting and the "continue in app" links |

## Install

Open Terminal and run these commands one at a time.

```bash
git clone https://github.com/lpts1011/pop-out-window-for-claude.git
```

```bash
cd pop-out-window-for-claude
```

```bash
npm install
```

Sign in to Claude Code once if you have not already:

```bash
claude
```

Then choose how to run it.

**As a real app (recommended).** This builds `/Applications/Claude Bar.app`, with no Dock icon and no Terminal window, and
opens it:

```bash
npm run build-app
```

You can also double-click `Build App.command` in Finder.

**From Terminal, for development:**

```bash
npm start
```

A ✳ icon appears in the menu bar. To start the app automatically, choose ✳ > **Launch at login**.

To update, pull the latest code, quit the running copy, and build again. The app is single-instance, so an old copy that is
still running silently blocks a new one:

```bash
pkill -f "Claude Bar"
```

## First run

1. Press **Option + Shift + Space**.
2. Type a message and press Enter. Quick mode needs no further setup.
3. To use Claude.ai mode, click **Claude.ai** at the top left, send a message and sign in inside the window.
   **Use "Continue with email"** and enter the code from your inbox. Do not use "Continue with Google", which commonly fails
   inside an embedded app window with "There was an error logging you in". If you normally sign in with Google, enter that
   same Google email address so you reach the same account.
4. macOS asks for Screen Recording permission the first time you use the screenshot hotkey. Turn on Claude Bar in
   System Settings > Privacy & Security > Screen Recording. Because the app is ad-hoc signed, macOS may ask again after a rebuild.

## The two modes

The switch at the top left picks the mode. Your choice is remembered, and switching keeps both conversations.

| | Quick | Claude.ai |
| --- | --- | --- |
| What it is | The window's own fast chat | The real claude.ai site inside the floating window |
| Chats appear in the Claude app and on your phone | No | Yes |
| Your Projects, memory and styles | No | Yes |
| Math, interactive views, PDFs, screenshots | Yes | The site's own versions |
| Powered by | `claude -p` with your Claude Code login | Your normal Claude plan on the site |

In Claude.ai mode, Enter in the small bar starts a real chat, History opens your Claude.ai chats, New returns to the small
bar, and ↗ opens the current chat in the Claude app. Links to other sites open in your normal browser.

To carry a Quick chat over, choose **⋯ > Move to a Claude.ai chat**. The conversation is placed in the text box of a new chat
for you to review and send. It is never sent automatically.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Option + Shift + Space | Show or hide the window |
| Enter | Send |
| Shift + Enter | New line |
| Cmd + N | New chat |
| Esc | Hide (in Claude.ai mode, closes the site's open menu first) |
| Option + Shift + S | Screenshot part of the screen and attach it |
| Cmd + V | Paste an image or file (you can also drag one in) |

The default hotkey does not clash with the Claude desktop app's Option + Space.

## Using the window

**Files (Quick).** Click **+**, drag files in, or paste. Each message can have up to 4 attachments: images (5 MB each), PDFs
(20 MB each), and text or code files (1 MB each).

**Screenshots.** Option + Shift + S hides the window so you can drag over part of the screen. In Quick mode the picture is
attached. In Claude.ai mode it is pasted into the site's text box.

**Web search (Quick).** With the globe on, Claude can search and read pages when a question needs current information, and it
cites sources as links. A reply that searches uses more of your plan than one that does not. Click the globe to turn it off.

**Connected apps (Quick).** **+ > Read my Gmail and Drive** lets Claude read the services you connected to your Claude account.
It is off by default because it makes each message use more of your plan. Tools that send, change or delete are blocked, and
any tool that is not on the known list is refused.

**Copy, Retry and Edit.** Copy keeps Markdown and LaTeX so it pastes cleanly into notes. Retry under the last reply asks again
and replaces that reply. Edit under your last message puts it back in the text box. Both fork the session from the earlier reply,
so Claude forgets the old answer. Images are resent only while the window is still open, because saved chats keep only the image count.

**History.** Each chat is saved after every reply. Claude Code removes old sessions after about 30 days. Reopening an older chat
still works, because the saved conversation is sent to a new session as text.

**Continue in the Claude app.** **⋯ > Continue in Claude app (Code tab)** opens the same conversation in the Claude app's Code
tab. There, Claude may use tools in the app's working folder, which it cannot do in this window.

**Usage.** The figure beside the model name, such as "Week 62%", is whichever plan limit is closest to running out. Hover to see
both limits and when they reset. It appears after your first Quick reply.

**Window size and position.** The window starts small and becomes a fixed-size chat window after your first message. It never grows
with the conversation. Drag its edges to resize it, and the size is remembered. It reappears where you last hid it.

**Logo.** No logo ships with this project, and a plain dot is shown instead. To use your own, add a square PNG of at least
128 x 128 at `renderer/logo.png`, using only an image you have the right to use.

## Configuration

Choose ✳ > **Open config file**, edit `config.json`, then choose ✳ > **Reload config**. The file is at
`~/Library/Application Support/claude-chatbar/config.json`.

| Key | Default | Meaning |
| --- | --- | --- |
| `shortcut` | `"Alt+Shift+Space"` | Global show or hide hotkey |
| `screenshotShortcut` | `"Alt+Shift+S"` | Global screenshot hotkey |
| `engine` | `"quick"` | `"quick"` or `"web"` (Claude.ai) |
| `authMode` | `"plan"` | `"plan"` uses your Claude login. `"apikey"` is pay-as-you-go |
| `apiKey` | `""` | Used only when `authMode` is `"apikey"` |
| `model` | `""` | For example `"sonnet"` or `"opus"`. Empty uses the Claude Code default |
| `effort` | `""` | `low`, `medium`, `high`, `xhigh` or `max`. Empty uses the default |
| `webSearch` | `true` | Allow web search and page reading |
| `connectors` | `false` | Allow read-only access to connected apps |
| `about` | `""` | Sent to Claude in every Quick chat. Also in ⋯ > Settings |
| `claudePath` | `""` | Full path to `claude`, only if it cannot be found |
| `systemPrompt` | built in | Instructions for Quick mode |
| `width` | `480` | Window width |
| `anchor` | `0.75` | First-launch vertical position (0 is the top, 1 is the bottom) |
| `maxHeight` | `220` | Tallest the small bar grows while you type |
| `chatHeight` | `520` | Chat window height |
| `chatWidth` | `0` | 0 means the same as `width` |
| `levelBoost` | `2147482631` | How far above the `screen-saver` window layer the window sits (1 to 2147482631) |

An invalid config file is copied to `config.json.bad`, and defaults are used so the app still starts.

## Important notes

**Billing and plan usage**

- In `plan` mode, any `ANTHROPIC_API_KEY` in your environment is deliberately ignored, so you cannot be billed through the API by
  accident. `authMode: "apikey"` is an explicit opt-in and is billed per use.
- Quick mode runs Claude Code in headless mode (`claude -p`). Anthropic's rules for headless and Agent SDK use can draw on a
  separate monthly credit that may need to be claimed in your account settings, and replies can stop when it runs out. Terms and
  limits change, so check Anthropic's current documentation for your plan.
- Web search and connected apps use more of your plan per message.

**Terms and appropriate use**

- You are responsible for following Anthropic's terms and usage policies, and those of any site you use.
- This is intended for personal use with your own account. Do not share an installation that uses your login with other people.
- Claude.ai mode only displays the website in a panel, signed in by you. It does not read the Claude app's login, does not call
  private Claude APIs and does not fake its user agent. Keep it that way if you modify the code.
- This project has no special handling for appearing over exam lockdown or proctoring software, and it must not be used to get
  around such rules. No window can appear over the macOS lock screen.

**Permissions and reach**

- Claude gets no file or shell tools in this window. The only tools it can have are web search, page reading and the read-only
  connector tools.
- The app is ad-hoc signed and not notarized. It is built on your own Mac, and macOS may show extra prompts.
- The default window level is the highest macOS allows, which also places it above the screen-capture shield level. Lower
  `levelBoost` if you do not want that. The window may be visible during screen sharing or recording.

**Stability**

- Claude.ai mode depends on the layout of a website that can change at any time. If automatic sending fails, your text stays in
  the box and you can press Enter yourself.
- Retry and Edit use `--resume-session-at`, a hidden Claude Code option that could change in a later release.

**Never test against your real login.** Do not run an unpackaged Electron build or a test harness against the app's real data
folder. Cookies are encrypted with a Keychain key tied to the app's name, so such a run sees the panel as signed out, and the site can
then replace the stored login, which signs you out. See `CLAUDE.md` for how to test safely.

## Where your data is stored

Everything is under `~/Library/Application Support/claude-chatbar/`.

| Item | Location | Notes |
| --- | --- | --- |
| Settings | `config.json` | Contains `apiKey` if you set one, in plain text |
| Saved Quick chats | `chats/` | One readable JSON file per chat. Text and image counts only, never image data |
| Claude.ai login | Electron's partition storage | Kept by the site's own storage for this app, and never read by this project's code |
| Claude Code sessions | Managed by Claude Code | Sessions run from the `Claude Bar` folder in the location above |

To remove everything, quit the app, delete `/Applications/Claude Bar.app`, and delete the folder above. Do not commit your config
file or chats to a repository.

## Security model

- Context isolation is on and `preload.js` is the only bridge between the page and the main process.
- The main window has a strict Content-Security-Policy.
- Interactive views run in `<iframe sandbox="allow-scripts">` with their own policy that blocks all network access.
- Markdown is rendered through a safe renderer, and link addresses cannot inject attributes.
- The Claude.ai panel is sandboxed in its own storage partition. Only Claude, Anthropic and their sign-in hosts load inside it.
  Other links open in your normal browser.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "Could not find the `claude` command" | Install Claude Code and run `claude` once in Terminal. If it still fails, run `which claude` and put the result in `claudePath` |
| "There was an error logging you in" | Use "Continue with email", not Google |
| The new build does not appear | An old copy is still running. Quit it from ✳ > Quit or run `pkill -f "Claude Bar"`, then rebuild |
| The hotkey does nothing | Another app may own it. Change `shortcut` in the config file |
| The hotkey only removes focus from your current window, or switches you to another desktop or full-screen app | Update to the latest version. If it still happens, choose ✳ > Quit, then open the app again |
| The screenshot hotkey fails | Turn on Screen Recording for Claude Bar in System Settings. After a rebuild, you may need to switch it off and on |
| Claude.ai message stays in the box | Press Enter yourself. This can happen when the window cannot take focus |
| Replies stop | Your plan or monthly credit may have run out. Hover over the usage figure to see when it resets |
| An old chat restarts with less memory | Its Claude Code session expired, so the saved text was sent to a new session |

## Known limitations and untested areas

- macOS only. There is no Windows or Linux support.
- No custom app icon is included.
- These have only been tested against a local stand-in page, or not yet tested on a real Mac: typing very long messages and pasting
  screenshots into the real Claude.ai site, the ↗ deep link, opening a conversation in the Code tab, and staying above other apps' pop-out windows.
- Thinking blocks are displayed if Claude Code streams them, but none appeared in testing.
- In Claude.ai mode, the automatic Enter can be lost when the window cannot take focus, such as when the screen is locked.

## Development

```bash
npm test
```

The tests use plain Node. `claudeweb.test.js` needs `electron` installed by `npm install`. See [`CLAUDE.md`](CLAUDE.md) for
architecture, design decisions and safe testing instructions.

## License

MIT, see [`LICENSE`](LICENSE). Third-party components are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

Claude and Anthropic are trademarks of Anthropic. This project is not affiliated with or endorsed by Anthropic.
