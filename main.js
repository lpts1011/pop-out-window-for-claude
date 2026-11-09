'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, screen, shell, nativeImage, nativeTheme, clipboard } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ask } = require('./claude');
const { buildHandoff } = require('./handoff');
const { createStore, cleanMessages } = require('./chats');
const { createPane } = require('./claudeweb');

const OLD_PROMPT = 'You are a quick-answer chat bar. Keep replies concise unless asked for detail.';
const PROMPT_RULES =
  'Use Markdown for structure. Write ALL mathematics and physics formulas in LaTeX, inline as $...$ and ' +
  'display as $$...$$ (for example $\\frac{a}{b}$, $\\sqrt{x}$, $x^2$); never write real maths as plain text such as a/b or x^2. ' +
  'Show calculation steps one per line using display maths. ' +
  'When an interactive visual would genuinely help explain something (a graph with a slider, a geometry demo, a small simulation), ' +
  'output ONE self-contained HTML document inside a ```widget code fence. It must use only inline CSS and vanilla JavaScript ' +
  '(canvas or inline SVG), with no external files, libraries, fonts or network calls, a transparent background, ' +
  'colours that work in light and dark mode, and a compact layout under about 420px tall. ' +
  'Do not use a widget when plain text and formulas are enough.';
const PROMPT_V4 =
  'You are a quick-answer chat bar in a small floating window. Keep replies concise unless asked for detail, ' +
  'and answer in the language the user writes in. ' + PROMPT_RULES;
const DEFAULT_PROMPT =
  'You are Claude, made by Anthropic, talking with someone in a small floating window on their Mac. ' +
  'Write the way you would in any Claude conversation: warm, direct and natural. Keep replies short unless they ask for detail, ' +
  'and answer in the language they write in. ' + PROMPT_RULES;

const DEFAULTS = {
  configVersion: 5,
  // Option + Shift + Space (so it does not clash with Claude Desktop's Option + Space).
  shortcut: 'Alt+Shift+Space',
  screenshotShortcut: 'Alt+Shift+S', // drag over part of the screen and attach it
  engine: 'quick', // 'quick' = the bar's own chat; 'web' = the real claude.ai (synced chats)
  authMode: 'plan', // "plan" = your Claude login via the claude CLI; "apikey" = pay-as-you-go
  apiKey: '',
  model: '', // e.g. "sonnet" or "opus"; empty = Claude Code default
  effort: '', // low | medium | high | xhigh | max; empty = default
  webSearch: true, // let Claude search the web and read pages (the globe switch in the bar)
  connectors: false, // let Claude read your connected Gmail and Google files (reading only)
  about: '', // Settings > About you: sent to Claude in Quick chats
  claudePath: '',
  systemPrompt: DEFAULT_PROMPT,
  width: 480,
  levelBoost: 2147482631, // how far above the 'screen-saver' window layer (1000) the bar sits (1 to 2147482631)
  anchor: 0.75, // the bar sits this far down the screen (0 = top, 1 = bottom)
  maxHeight: 220, // tallest the small bar grows while you type a long question
  chatHeight: 520, // fixed height of the chat window after your first message (drag to change)
  chatWidth: 0, // 0 = same as width; changes when you drag-resize
};

app.setName('claude-chatbar'); // keep the same settings folder whether run via npm or as an app
let config = { ...DEFAULTS };
let win = null;
let quitting = false;
let lastBounds = null; // where the bar was when it was last hidden or moved
let mode = 'compact'; // 'compact' = small self-sizing bar, 'chat' = fixed-size chat window
const alive = () => win && !win.isDestroyed();
const sendToWin = (ch, payload) => { if (alive()) win.webContents.send(ch, payload); };
let tray = null;
let sessionId = null;
let running = null;
let chatId = null; // the saved chat that is open (null until its first reply is saved)
let store = null; // saved chat history (see chats.js)
let pane = null; // the claude.ai panel (see claudeweb.js), made the first time it is needed
let webOpen = false; // a claude.ai page is in use
let usage = null; // latest plan usage reported by Claude Code

// The bar's Claude sessions live in this fixed folder (not the temp folder), so they are easy to
// find again and can be opened in the Claude app's Code tab.
const workDir = () => path.join(app.getPath('userData'), 'Claude Bar');

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    config = { ...DEFAULTS, ...saved };
    // A mistyped number here would otherwise stop the window from opening.
    for (const k of ['width', 'maxHeight', 'chatHeight', 'chatWidth', 'anchor', 'levelBoost']) {
      if (typeof config[k] !== 'number' || !Number.isFinite(config[k]) || config[k] < 0) config[k] = DEFAULTS[k];
    }
    if (config.width < 320) config.width = DEFAULTS.width;
    if (config.chatHeight < 180) config.chatHeight = DEFAULTS.chatHeight;
    if (config.chatWidth && config.chatWidth < 320) config.chatWidth = DEFAULTS.chatWidth;
    if (config.anchor > 1) config.anchor = DEFAULTS.anchor;
    if (config.engine !== 'quick' && config.engine !== 'web') config.engine = 'quick';
    if ((saved.configVersion || 1) < DEFAULTS.configVersion) {
      // one-off upgrade from the older defaults
      if (saved.shortcut === undefined || saved.shortcut === 'Alt+Space') config.shortcut = DEFAULTS.shortcut;
      if (saved.width === undefined || saved.width === 640) config.width = DEFAULTS.width;
      config.maxHeight = DEFAULTS.maxHeight;
      if (saved.systemPrompt === undefined || saved.systemPrompt === OLD_PROMPT || saved.systemPrompt === PROMPT_V4) config.systemPrompt = DEFAULT_PROMPT;
      config.anchor = DEFAULTS.anchor;
      config.configVersion = DEFAULTS.configVersion;
      saveConfig();
    }
  } catch (err) {
    config = { ...DEFAULTS };
    try {
      // A file that cannot be read is kept, so a typing mistake does not lose your settings.
      if (err.code !== 'ENOENT') fs.copyFileSync(configPath(), configPath() + '.bad');
      fs.mkdirSync(path.dirname(configPath()), { recursive: true });
      fs.writeFileSync(configPath(), JSON.stringify(DEFAULTS, null, 2));
    } catch (_) {}
  }
}

// Put the bar on the 'screen-saver' layer plus `levelBoost`, so other floating windows
// (for example ChatGPT's pop-out window) cannot cover it. At the default boost this is
// level 2147483631 (kCGMaximumWindowLevel), the highest macOS allows.
function applyLevel() {
  if (!alive()) return;
  const boost = Math.max(1, Math.min(Math.round(Number(config.levelBoost) || 2147482631), 2147482631));
  try {
    win.setAlwaysOnTop(pinned, 'screen-saver', boost);
  } catch (_) {
    win.setAlwaysOnTop(pinned, 'screen-saver', 1);
  }
}

// Use the same light or dark setting as the Claude app. Only that one setting is read.
function applyTheme() {
  let mode = 'system';
  try {
    const file = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'config.json');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')).userThemeMode;
    if (saved === 'light' || saved === 'dark') mode = saved;
  } catch (_) {}
  if (nativeTheme.themeSource !== mode) nativeTheme.themeSource = mode;
  if (pane) pane.setBackground(nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5');
}

function createWindow() {
  win = new BrowserWindow({
    width: config.width,
    height: 96,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    vibrancy: 'under-window', // native macOS blur; follows light/dark and Reduce transparency
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Float above everything, including full-screen apps and every Space.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyLevel(); // after the line above: on macOS that call can reset the window level
  // Closing the bar (e.g. Cmd+W) only hides it; it is destroyed only when the app quits.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', () => {
    if (!alive() || quitting) return;
    // The page starts empty again, so start a clean chat. The old one is still in History.
    if (running) running.cancel();
    running = null;
    sessionId = null;
    chatId = null;
    if (!paneShowing()) setMode('compact');
    win.reload();
  });
  win.webContents.on('did-finish-load', sendConfig);
  win.on('blur', () => setTimeout(raiseIfCovered, 60));
  win.on('show', () => { raiseIfCovered(); startKeepOnTop(); });
  win.on('hide', stopKeepOnTop);
  win.on('moved', () => { if (alive()) lastBounds = win.getBounds(); });
  win.on('resize', layoutPane);
  // Remember the size you drag the chat window to.
  let userResizing = false, saveTimer = null;
  const finishResize = () => {
    userResizing = false;
    if (mode !== 'chat' || !alive()) return;
    const [w, h] = win.getSize();
    config.chatWidth = w;
    config.chatHeight = h;
    saveConfig();
  };
  win.on('will-resize', () => { userResizing = true; clearTimeout(saveTimer); saveTimer = setTimeout(finishResize, 700); });
  win.on('resize', () => { if (userResizing) { clearTimeout(saveTimer); saveTimer = setTimeout(finishResize, 700); } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault(); // this window only ever shows its own page
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
}

const COMPACT_HEIGHT = 128;
const TOP_BAR = 42; // height of the bar's title row; the claude.ai panel sits below it

function sendConfig() {
  sendToWin('config', {
    model: config.model,
    effort: config.effort,
    webSearch: config.webSearch !== false,
    connectors: !!config.connectors,
    about: config.about || '',
    engine: config.engine,
    shortcut: config.shortcut,
    screenshotShortcut: config.screenshotShortcut,
    webShowing: paneShowing(),
  });
  if (usage) sendToWin('usage', usage);
  if (shortcutProblem) sendToWin('notice', shortcutProblem);
}

const paneShowing = () => !!pane && webOpen && config.engine === 'web' && mode === 'chat';

function layoutPane() {
  if (!pane || !alive()) return;
  if (webOpen) pane.attach(win); // the window may have been recreated
  const [width, height] = win.getContentSize();
  pane.layout(paneShowing(), { x: 6, y: TOP_BAR, width: width - 12, height: Math.max(0, height - TOP_BAR - 6) });
}

function ensurePane() {
  if (!pane) {
    pane = createPane({
      onEscape: hideBar,
      onNew: () => newChat(),
      onLoadFailed: () => sendToWin('notice', "Couldn't reach claude.ai. Check your connection."),
      onState: (s) => {
        sendToWin('web-state', s);
        if (s.signIn) sendToWin('notice', 'Sign in with "Continue with email"');
      },
    });
  }
  pane.attach(win);
  applyTheme();
}

// Bring up a claude.ai page in the floating window.
function openWeb(load) {
  ensurePane();
  webOpen = true;
  config.engine = 'web';
  setMode('chat');
  load();
  layoutPane();
  pane.focus();
}

// Centre horizontally; the compact bar's top edge sits `anchor` of the way down the screen.
// When the chat grows, the window grows upward so the input box stays put.
function positionWindow() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w, h] = win.getSize();
  const bottom = y + height * config.anchor + COMPACT_HEIGHT;
  const top = Math.max(y, Math.min(Math.round(bottom - h), y + height - h));
  win.setPosition(Math.round(x + (width - w) / 2), top);
}

// Switch between the small bar and the fixed-size chat window. The bottom edge stays put,
// so the text box does not move; the window grows upward.
function setMode(next) {
  if (!alive()) return;
  mode = next;
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const chat = next === 'chat';
  const w = Math.min(chat ? config.chatWidth || config.width : config.width, wa.width);
  const h = Math.min(chat ? config.chatHeight : COMPACT_HEIGHT, wa.height);
  const bottom = b.y + b.height;
  const top = Math.max(wa.y, Math.min(bottom - h, wa.y + wa.height - h));
  const left = Math.max(wa.x, Math.min(Math.round(b.x + (b.width - w) / 2), wa.x + wa.width - w));
  win.setResizable(chat);
  win.setMinimumSize(chat ? 320 : 1, chat ? 180 : 1);
  win.setBounds({ x: left, y: top, width: Math.round(w), height: Math.round(h) });
  layoutPane();
}

const onScreen = (b) =>
  screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return w > 100 && h > 40;
  });

// Reappear exactly where the bar was hidden; the default spot is only for the very first time.
function restoreOrPosition() {
  if (lastBounds && onScreen(lastBounds)) win.setPosition(lastBounds.x, lastBounds.y);
  else positionWindow();
}

function showBar() {
  const fresh = !alive();
  if (fresh) createWindow(); // recreate if it was ever destroyed
  const go = () => {
    if (!alive()) return;
    if (!win.isVisible()) restoreOrPosition();
    if (process.platform === 'darwin') {
      // hideBar() hides the whole app, so undo that first and take focus reliably. Without this
      // the app could become active while its window never reached the screen.
      app.show();
      app.focus({ steal: true });
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      applyLevel(); // after the line above, which can reset the level
    }
    win.show();
    win.focus();
    applyTheme();
    if (paneShowing()) pane.focus();
    else win.webContents.send('focus-input');
  };
  if (fresh) win.webContents.once('did-finish-load', go);
  else go();
}

function hideBar() {
  if (alive() && win.isVisible()) {
    lastBounds = win.getBounds();
    win.hide();
  }
  if (process.platform === 'darwin') app.hide(); // hand focus back to the previous app
}

function toggleBar() {
  if (alive() && win.isVisible() && win.isFocused()) hideBar();
  else showBar();
}

// A shortcut that is mistyped, or already used by another app, must not stop the app.
function registerOne(accelerator, action) {
  try {
    return !accelerator || globalShortcut.register(accelerator, action);
  } catch (_) {
    return false;
  }
}

let shortcutProblem = ''; // shown in the bar, also if the page was still loading
function registerShortcut() {
  globalShortcut.unregisterAll();
  const bad = [];
  if (!registerOne(config.shortcut, toggleBar)) bad.push(config.shortcut);
  if (!registerOne(config.screenshotShortcut, screenshot)) bad.push(config.screenshotShortcut);
  shortcutProblem = bad.length ? `Can't use ${bad.join(' or ')}. Change it in the config file.` : '';
  if (shortcutProblem) sendToWin('notice', shortcutProblem);
}

// Drag over part of the screen; the picture is attached to your next message.
let capturing = false;
function screenshot() {
  if (capturing) return;
  capturing = true;
  const file = path.join(app.getPath('temp'), `claude-bar-${Date.now()}.png`);
  if (alive() && win.isVisible()) { lastBounds = win.getBounds(); win.hide(); } // keep the bar out of the picture
  execFile('/usr/sbin/screencapture', ['-i', '-x', file], () => {
    capturing = false;
    let image = null;
    try { image = nativeImage.createFromPath(file); fs.unlinkSync(file); } catch (_) {}
    showBar();
    if (!image || image.isEmpty()) return; // you pressed Esc instead of choosing an area
    if (config.engine === 'web') {
      clipboard.writeImage(image);
      if (!paneShowing()) {
        openWeb(() => pane.open('/new'));
        sendToWin('engine', 'web');
      }
      pane.pasteWhenReady().then((ok) => {
        if (!ok) sendToWin('notice', 'The picture is on your clipboard. Press Cmd+V in the text box.');
      });
      return;
    }
    let data = image.toPNG(), mediaType = 'image/png';
    if (data.length > 4 * 1024 * 1024) { // Claude takes up to 5 MB
      data = image.resize({ width: 1800 }).toJPEG(85);
      mediaType = 'image/jpeg';
    }
    sendToWin('attach', { mediaType, data: data.toString('base64') });
  });
}

function createTray() {
  // No icon file needed: show a text glyph in the menu bar instead.
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('✳');
  tray.setToolTip('Claude chat bar');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show chat bar', click: showBar },
      { label: 'New chat', click: () => newChat() },
      { label: 'Screenshot and ask', click: screenshot },
      { type: 'separator' },
      {
        label: 'Launch at login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { label: 'Open config file', click: () => shell.showItemInFolder(configPath()) },
      {
        label: 'Reload config',
        click: () => {
          loadConfig();
          registerShortcut();
          applyLevel();
          applyTheme();
          layoutPane();
          sendConfig();
        },
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ])
  );
  tray.on('click', toggleBar);
}

function newChat() {
  if (config.engine === 'web') { // the Quick chat on screen is left alone
    webOpen = false;
    setMode('compact');
    sendToWin('reset', { webOnly: true });
    return;
  }
  if (running) running.cancel();
  running = null;
  sessionId = null;
  chatId = null;
  setMode('compact');
  sendToWin('reset');
}

const MODELS = ['', 'sonnet', 'opus', 'haiku'];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_PDF = 20 * 1024 * 1024;
const MAX_TEXT_FILE = 1024 * 1024;

function saveConfig() {
  try {
    const tmp = configPath() + '.tmp'; // a crash while saving cannot leave half a file
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, configPath());
  } catch (_) {}
}

ipcMain.on('set-option', (_e, key, value) => {
  if (key === 'model' && MODELS.includes(value)) config.model = value;
  else if (key === 'effort' && EFFORTS.includes(value)) config.effort = value;
  else if (key === 'webSearch' && typeof value === 'boolean') config.webSearch = value;
  else if (key === 'connectors' && typeof value === 'boolean') config.connectors = value;
  else if (key === 'about' && typeof value === 'string') config.about = value.slice(0, 4000);
  else return;
  saveConfig();
});

// Switch between Quick and Claude.ai. Returns whether a claude.ai page should be showing.
ipcMain.handle('set-engine', (_e, engine) => {
  if (engine !== 'quick' && engine !== 'web') return false;
  config.engine = engine;
  saveConfig();
  if (engine === 'web' && mode === 'chat' && !webOpen) openWeb(() => pane.open('/new'));
  layoutPane();
  if (paneShowing()) pane.focus();
  return engine === 'web' && webOpen;
});
ipcMain.on('web-ask', (_e, text) => {
  if (typeof text !== 'string' || !text.trim()) return;
  openWeb(() => {
    pane.ask(text).then((ok) => {
      // short messages stay in the site's box by themselves; a long one may need pasting
      if (!ok && encodeURIComponent(text).length > 6000) {
        clipboard.writeText(text);
        sendToWin('notice', 'Your message is on your clipboard. Press Cmd+V in the text box.');
      }
    });
  });
});
ipcMain.on('web-open', (_e, where) => {
  if (where === '/new' || where === '/recents') openWeb(() => pane.open(where));
});
// Open the claude.ai chat on screen in the Claude app.
ipcMain.on('web-open-app', async () => {
  const chat = pane ? /^https:\/\/claude\.ai(\/chat\/[\w-]+)/.exec(pane.url()) : null;
  if (alive() && win.isVisible()) { lastBounds = win.getBounds(); win.hide(); }
  try {
    await shell.openExternal('claude://claude.ai' + (chat ? chat[1] : '/new'));
  } catch (_) {
    showBar();
    sendToWin('notice', 'Could not open the Claude app.');
  }
});
ipcMain.on('screenshot', screenshot);

// Earlier turns as plain text, used when a chat has to start over in a new session.
function priorText(prior) {
  const turns = cleanMessages(prior).filter((h) => h.text || h.images);
  if (!turns.length) return '';
  return buildHandoff(turns, { maxChars: 60000, maxEncoded: Infinity }).q + '\n\n---\n\n';
}

ipcMain.on('ask', (_e, payload) => {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
  const images = (Array.isArray(payload?.images) ? payload.images : [])
    .filter((i) => i && IMAGE_TYPES.includes(i.mediaType) && typeof i.data === 'string')
    .slice(0, 4);
  const attached = Array.isArray(payload?.files) ? payload.files.slice(0, 4) : [];
  const files = attached.filter((f) => f && f.mediaType === 'application/pdf' && typeof f.data === 'string' && f.data.length <= (MAX_PDF * 4) / 3 + 4);
  // Text files travel inside the message itself.
  const inlined = attached
    .filter((f) => f && typeof f.text === 'string' && f.text.length <= MAX_TEXT_FILE)
    .map((f) => `<file name="${String(f.name || 'file').replace(/["<>]/g, '')}">\n${f.text}\n</file>\n\n`)
    .join('');
  const prior = Array.isArray(payload?.prior) ? payload.prior : [];
  const resumeAt = typeof payload?.resumeAt === 'string' && /^[0-9a-f-]{36}$/i.test(payload.resumeAt) ? payload.resumeAt : null;
  if (running) running.cancel();
  // fresh = regenerate/edit with no earlier reply to fork from: start a new session
  if (payload?.fresh) sessionId = null;
  const start = (text, retried) => {
    const resumed = !!sessionId;
    running = ask({
      prompt: text,
      images,
      files,
      sessionId,
      resumeAt: resumed ? resumeAt : null,
      cwd: workDir(),
      config,
      handlers: {
        onText: (t) => sendToWin('delta', t),
        onStatus: (s) => sendToWin('status', s),
        onThinking: (t) => sendToWin('thinking', t),
        onUsage: (u) => { usage = u; sendToWin('usage', u); },
        onSession: (id) => (sessionId = id),
        onDone: (r) => { running = null; sendToWin('done', { uuid: r.uuid || null }); },
        onError: (m) => {
          // The old session is gone (Claude Code deletes old ones): carry on in a new session
          // with the conversation so far as text.
          if (resumed && !retried && /no conversation found/i.test(m)) {
            sessionId = null;
            start(priorText(prior) + inlined + prompt, true);
            return;
          }
          running = null;
          sendToWin('error', m);
        },
      },
    });
  };
  // No session to continue (first message, a fresh restart, or a saved chat whose session is
  // unknown): send the earlier turns as text so Claude still has the context.
  start(sessionId ? inlined + prompt : priorText(prior) + inlined + prompt, false);
});

// Save the open chat after each reply.
ipcMain.on('save-chat', (_e, messages) => {
  if (!store || !Array.isArray(messages) || !messages.length) return;
  try {
    if (!chatId) chatId = store.newId();
    store.save({ id: chatId, sessionId, messages });
  } catch (err) {
    console.error('could not save chat:', err.message);
  }
});
ipcMain.handle('list-chats', () => (store ? store.list() : []));
ipcMain.handle('open-chat', (_e, id) => {
  const chat = store && store.load(id);
  if (!chat) return null;
  if (running) running.cancel();
  running = null;
  chatId = chat.id;
  sessionId = chat.sessionId;
  setMode('chat');
  return { messages: chat.messages, hasSession: !!sessionId };
});
ipcMain.handle('delete-chat', (_e, id) => {
  if (!store) return false;
  const ok = store.remove(id);
  if (ok && id === chatId) chatId = null; // the open chat stays on screen and is saved again as new
  return ok;
});
ipcMain.on('copy', (_e, text) => { if (typeof text === 'string') clipboard.writeText(text.slice(0, 2000000)); });

// Open this exact conversation in the Claude app's Code tab (the app imports the session).
ipcMain.on('continue-code', async () => {
  if (!sessionId || running) return;
  if (alive() && win.isVisible()) { lastBounds = win.getBounds(); win.hide(); }
  try {
    await shell.openExternal('claude://resume?session=' + encodeURIComponent(sessionId));
  } catch (_) {
    showBar();
    sendToWin('notice', 'Could not open the Claude app.');
  }
});
ipcMain.handle('has-session', () => !!sessionId);

ipcMain.on('stop', () => { if (running) running.cancel(); running = null; sendToWin('done'); });
ipcMain.on('new-chat', newChat);

// Move this conversation into a real Claude chat: claude.ai opens with the transcript in its
// text box, ready for you to read and send.
ipcMain.on('handoff', (_e, history) => {
  if (!Array.isArray(history) || !history.length) return;
  const safe = history
    .slice(-200)
    .map((h) => ({ role: h && h.role === 'user' ? 'user' : 'assistant', text: String((h && h.text) || '').slice(0, 100000), images: Number(h && h.images) || 0 }));
  const { full, q, truncated } = buildHandoff(safe);
  clipboard.writeText(full); // fallback: paste it yourself if anything gets cut
  openWeb(() => {
    pane.ask(q, { send: false }).then((ok) => {
      if (!ok) sendToWin('notice', 'The chat is on your clipboard. Press Cmd+V in the text box.');
    });
  });
  saveConfig();
  sendToWin('engine', 'web');
  if (truncated) sendToWin('notice', 'Only the latest messages fit. The full chat is on your clipboard.');
});
ipcMain.on('mode', (_e, m) => { if (m === 'chat' || m === 'compact') setMode(m); });
ipcMain.on('hide', hideBar);
let pinned = true;
ipcMain.on('pin', (_e, v) => {
  pinned = !!v;
  applyLevel();
});

// If another floating window gets in front, take the top spot straight back.
let lastRaise = 0;
function raiseIfCovered() {
  if (!alive() || !win.isVisible() || !pinned) return;
  const now = Date.now();
  if (now - lastRaise < 250) return; // avoid a tug-of-war with another app doing the same
  lastRaise = now;
  applyLevel();
  win.moveTop(); // puts it in front without taking keyboard focus
}

// While the bar is showing, quietly re-assert its position once a second and its layer every 5 seconds.
let keepTimer = null;
function stopKeepOnTop() {
  if (keepTimer) clearInterval(keepTimer);
  keepTimer = null;
}
function startKeepOnTop() {
  stopKeepOnTop();
  let tick = 0;
  keepTimer = setInterval(() => {
    if (!alive() || !win.isVisible() || !pinned) return;
    if (++tick % 5 === 0) applyLevel();
    win.moveTop();
  }, 1000);
}
ipcMain.on('resize', (_e, h) => {
  if (!alive() || mode !== 'compact') return;
  // the Model and + menus need room while they are open
  const height = Math.max(COMPACT_HEIGHT, Math.min(Math.round(h), Math.max(config.maxHeight, 460)));
  const b = win.getBounds();
  const { y, height: sh } = screen.getDisplayMatching(b).workArea;
  const bottom = b.y + b.height; // keep the bottom edge fixed, grow upward
  const top = Math.max(y, Math.min(bottom - height, y + sh - height));
  win.setBounds({ x: b.x, y: top, width: b.width, height });
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', showBar);
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) app.dock.hide(); // menu-bar style app
    // Only editing and quit shortcuts. The default menu's Cmd+R would wipe the chat on screen.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Claude Bar', submenu: [{ role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ role: 'close' }] },
    ]));
    loadConfig();
    applyTheme();
    store = createStore(path.join(app.getPath('userData'), 'chats'));
    try { fs.mkdirSync(workDir(), { recursive: true }); } catch (_) {}
    createWindow();
    createTray();
    registerShortcut();
    win.webContents.once('did-finish-load', showBar);
  });
  app.on('before-quit', () => {
    quitting = true;
    if (running) running.cancel(); // do not leave a reply running with nobody to read it
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', (e) => e.preventDefault());
}
