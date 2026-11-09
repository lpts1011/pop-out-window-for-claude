'use strict';
// The "Claude.ai" engine: the real claude.ai site in a panel of the floating window, signed in
// with your own account. Chats made here are normal Claude chats, so they sync with the Claude
// app and your phone. Nothing here reads your login or calls private Claude APIs.

const { WebContentsView, session, shell } = require('electron');

const HOME = 'https://claude.ai';
const MAX_ENCODED = 6000; // longer text is typed into the box instead of going in the web address

// Only these sites load inside the panel; every other link opens in your normal browser.
const PANEL_HOST = /^(?:[\w-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)$|^accounts\.google\.com$|^appleid\.apple\.com$/;

function isPanelUrl(url, base) {
  try {
    const u = new URL(url);
    if (base && u.origin === new URL(base).origin) return true;
    return u.protocol === 'https:' && PANEL_HOST.test(u.hostname);
  } catch (_) {
    return false;
  }
}

function openOutside(url) {
  if (/^https?:/.test(url)) shell.openExternal(url);
}

// Pressing Enter only when the box holds what was asked for: compare the start, ignoring spaces.
const compact = (s) => String(s).replace(/\s+/g, '').slice(0, 24);

function createPane({ base = HOME, partition = 'persist:claudeai', radius = 14, onEscape, onNew, onState, onLoadFailed }) {
  let view = null;
  let parent = null;
  let sendId = 0;

  const report = () => {
    if (!view || !onState) return;
    const url = view.webContents.getURL();
    onState({ url, title: view.webContents.getTitle(), signIn: /\/login(\b|\/|\?|$)/.test(url) });
  };

  function create() {
    const ses = session.fromPartition(partition);
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['clipboard-read', 'clipboard-sanitized-write'].includes(perm)));
    view = new WebContentsView({
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    if (view.setBorderRadius) view.setBorderRadius(radius);
    view.setVisible(false);
    const wc = view.webContents;
    // Main page only: the site's embedded frames (payments, security checks) may go anywhere.
    const guard = (e, url, _inPlace, isMainFrame) => {
      if (isMainFrame !== false && !isPanelUrl(url, base)) { e.preventDefault(); openOutside(url); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
    wc.on('did-fail-load', (_e, code, _text, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && onLoadFailed) onLoadFailed(); // -3 is a redirect or a cancelled load
    });
    wc.on('did-navigate', report);
    wc.on('did-navigate-in-page', report);
    wc.on('page-title-updated', report);
    wc.on('render-process-gone', () => { if (view && !wc.isDestroyed()) wc.reload(); });
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      if (input.meta && !input.shift && input.key.toLowerCase() === 'n') { e.preventDefault(); if (onNew) onNew(); return; }
      if (input.key === 'Escape' && !input.isComposing) {
        // Esc closes the site's own menus first; it hides the bar only when none is open.
        wc.executeJavaScript('!!document.querySelector(\'[role="menu"],[role="dialog"],[role="listbox"]\')')
          .then((busy) => { if (!busy && onEscape) onEscape(); })
          .catch(() => { if (onEscape) onEscape(); });
      }
    });
  }

  function attach(win) {
    if (!view) create();
    if (parent !== win) {
      win.contentView.addChildView(view);
      parent = win;
    }
  }

  function load(url) {
    sendId++; // a newer page cancels any automatic send still waiting
    view.webContents.loadURL(url).catch(() => {}); // redirects report as an abort; the page still loads
  }

  const open = (path) => load(base + path);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BOX = `document.querySelector('[contenteditable="true"]')`;

  // Waits for the site's text box. Returns its text, or null if it never comes (not signed in).
  async function boxText(id, ready) {
    const wc = view.webContents;
    const until = Date.now() + 15000;
    while (Date.now() < until && id === sendId && !wc.isDestroyed()) {
      const now = await wc.executeJavaScript(`(()=>{const e=${BOX};if(!e)return null;e.focus();return e.innerText})()`).catch(() => null);
      if (now !== null && ready(now)) return now;
      await sleep(250);
    }
    return null;
  }

  function pressEnterOnce(wc) {
    wc.focus();
    for (const type of ['keyDown', 'char', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Return' });
  }

  // A key press can get lost on the first page a new panel loads. The site empties the box when
  // a message is sent, so press once more only if the same text is still sitting there.
  async function pressEnter(id, wc, text) {
    const want = compact(text);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (id !== sendId || wc.isDestroyed()) return false;
      pressEnterOnce(wc);
      const until = Date.now() + 2500;
      while (Date.now() < until) {
        await sleep(150);
        if (id !== sendId || wc.isDestroyed()) return false;
        const now = await wc.executeJavaScript(`(()=>{const e=${BOX};return e?e.innerText:null})()`).catch(() => null);
        if (now === null || compact(now) !== want) return true;
      }
    }
    return false;
  }

  // Wait for the site to fill its text box from ?q=, then press Enter in it.
  async function pressEnterWhenReady(text) {
    const id = sendId;
    const wc = view.webContents;
    const want = compact(text);
    await new Promise((done) => wc.once('did-finish-load', done));
    if ((await boxText(id, (now) => compact(now) === want)) === null) return false; // the text stays in the box for you
    await sleep(200);
    return pressEnter(id, wc, text);
  }

  // For text too long for a web address: type it into an empty box.
  async function typeIn(text, send) {
    const id = sendId;
    const wc = view.webContents;
    await new Promise((done) => wc.once('did-finish-load', done));
    if ((await boxText(id, () => true)) === null || id !== sendId) return false;
    await wc.executeJavaScript(`(()=>{const e=${BOX};e.focus();document.execCommand('insertText',false,${JSON.stringify(text)})})()`).catch(() => {});
    const now = await boxText(id, (t) => compact(t) === compact(text));
    if (now === null) return false;
    if (!send) return true;
    await sleep(200);
    return pressEnter(id, wc, text);
  }

  // Start a real chat with this text (or only fill the box, with { send: false }).
  // Resolves false if it could not be put in the box.
  function ask(text, opts) {
    const send = !opts || opts.send !== false;
    const encoded = encodeURIComponent(text);
    if (encoded.length > MAX_ENCODED) {
      load(base + '/new');
      return typeIn(text, send);
    }
    load(base + '/new?q=' + encoded);
    return send ? pressEnterWhenReady(text) : Promise.resolve(true);
  }

  // Paste what is on the clipboard into the site's text box, once it exists.
  async function pasteWhenReady() {
    const wc = view.webContents;
    if ((await boxText(sendId, () => true)) === null) return false;
    wc.focus();
    wc.paste();
    return true;
  }

  return {
    attach,
    open,
    ask,
    pressEnterWhenReady,
    isLoaded: () => !!view && !!view.webContents.getURL(),
    url: () => (view ? view.webContents.getURL() : ''),
    layout(visible, bounds) {
      if (!view) return;
      if (bounds) view.setBounds(bounds);
      view.setVisible(!!visible);
    },
    focus() { if (view) view.webContents.focus(); },
    pasteWhenReady,
    setBackground(color) { if (view) view.setBackgroundColor(color); },
    get contents() { return view ? view.webContents : null; },
  };
}

module.exports = { createPane, isPanelUrl };
