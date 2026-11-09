'use strict';
const $ = (id) => document.getElementById(id);
const log = $('log'), input = $('input'), send = $('send');
let busy = false;
let current = null; // the assistant message element being streamed
let raw = '';
let status = ''; // "Searching the web…" line shown while Claude uses the web
let history = []; // {role, text, images, uuid?}: saved, used for regenerate and "continue in the Claude app"
let images = []; // attachments: {mediaType, data, url} for images, {name, mediaType, data} for PDFs, {name, text} for text files
let pendingFiles = 0; // attachments still being read from disk
let doneWaiter = null; // lets openSaved wait until a stopped reply has been saved
let webTitle = ''; // title of the claude.ai page, kept while Quick is showing
let thinking = ''; // Claude's visible reasoning for the reply being streamed
let engine = 'quick'; // 'quick' = this window's own chat, 'web' = the real claude.ai
let shortcuts = {};
let aboutText = '';
const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;
let lastSent = null; // {text, images} of the last message sent from this window, so Retry/Edit can resend its images
let editing = false;
let histFromCompact = false;
const MAX_IMAGES = 4, MAX_BYTES = 5 * 1024 * 1024, MAX_PDF = 20 * 1024 * 1024, MAX_TEXT = 1024 * 1024;
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|swift|kt|m|r|sql|sh|tex|bib|log)$/i;
const isImage = (a) => /^image\//.test(a.mediaType || '');
const isPdf = (a) => a.mediaType === 'application/pdf';

let chatMode = false; // false = small bar that sizes itself; true = fixed-size chat window
const render = (md, opts) => Md.render(md, opts);

function fit() {
  if (chatMode) return; // chat window keeps its size; only the user resizes it
  const pop = openPop ? openPop.offsetHeight + (openPop.classList.contains('top') ? 8 : 12) : 0;
  window.bar.resize($('top').offsetHeight + $('composer').offsetHeight + 10 + pop);
}
function enterChat() {
  if (chatMode) return;
  chatMode = true;
  document.body.classList.add('chat');
  window.bar.setMode('chat');
}
function leaveChat() {
  chatMode = false;
  document.body.classList.remove('chat');
  window.bar.setMode('compact');
  fit();
}

// Interactive views (```widget blocks) run in a sandboxed iframe with no network access.
function mountWidgets(el, sources) {
  el.querySelectorAll('.widget-slot').forEach((slot) => {
    const html = sources[Number(slot.dataset.w)];
    if (typeof html !== 'string') return;
    const f = document.createElement('iframe');
    f.className = 'widget';
    f.setAttribute('sandbox', 'allow-scripts');
    f.src = 'widget.html';
    f.addEventListener('load', () => f.contentWindow.postMessage({ type: 'widget-html', html }, '*'));
    slot.replaceWith(f);
  });
}
window.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'widget-height') return;
  for (const f of document.querySelectorAll('iframe.widget')) {
    if (f.contentWindow === e.source) {
      f.style.height = Math.min(Math.max((Number(e.data.h) || 0) + 2, 60), 600) + 'px';
    }
  }
});

// ---------- small buttons under messages ----------
const forCopy = (md) => md.replace(/```widget[\s\S]*?(```|$)/g, '[interactive view]').trim();
function actBtn(name, title, onClick, cls) {
  const b = document.createElement('button');
  b.className = 'act' + (cls ? ' ' + cls : '');
  b.innerHTML = icon(name);
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
  return b;
}
function copyBtn(getText, cls) {
  return actBtn('copy', 'Copy', (b) => {
    window.bar.copy(getText());
    b.innerHTML = icon('check');
    setTimeout(() => (b.innerHTML = icon('copy')), 1200);
  }, cls);
}
function addCodeCopy(el) {
  el.querySelectorAll('pre').forEach((pre) => {
    const wrap = document.createElement('div');
    wrap.className = 'codewrap';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const code = pre.querySelector('code') || pre;
    wrap.appendChild(copyBtn(() => code.textContent, 'codecopy'));
  });
}
function thinkBlock(text, open) {
  const d = document.createElement('details');
  d.className = 'think';
  d.open = open;
  const s = document.createElement('summary');
  s.textContent = open ? 'Thinking' : 'Thought process';
  const body = document.createElement('div');
  body.textContent = text;
  d.append(s, body);
  return d;
}
function renderBot(el, md, thought) {
  const widgets = [];
  el.innerHTML = render(md, { final: true, widgets });
  if (thought) el.prepend(thinkBlock(thought, false));
  mountWidgets(el, widgets);
  addCodeCopy(el);
  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.appendChild(copyBtn(() => forCopy(md)));
  el.appendChild(acts);
}

// Retry and Edit only ever apply to the last turn.
function refreshTurnActions() {
  log.querySelectorAll('.turnact').forEach((b) => b.remove());
  if (busy || editing) return;
  const users = log.querySelectorAll('.msg.user');
  const lastUser = users[users.length - 1];
  if (!lastUser) return;
  const editRow = document.createElement('div');
  editRow.className = 'acts right turnact';
  editRow.appendChild(actBtn('edit', 'Edit', startEdit));
  lastUser.after(editRow);
  const retry = actBtn('retry', 'Retry', regenerate, 'turnact');
  const bots = log.querySelectorAll('.msg.bot');
  const lastBot = bots[bots.length - 1];
  const botAfter = lastBot && lastUser.compareDocumentPosition(lastBot) & Node.DOCUMENT_POSITION_FOLLOWING;
  if (botAfter && lastBot.querySelector(':scope > .acts')) {
    lastBot.querySelector(':scope > .acts').appendChild(retry);
  } else {
    // no reply (it failed or was stopped early): put Retry on its own row
    const row = document.createElement('div');
    row.className = 'acts turnact';
    row.appendChild(retry);
    log.appendChild(row);
  }
}

// ---------- sending ----------
function finishMessage(uuid) {
  status = '';
  if (!current) return;
  current.classList.remove('dots');
  if (!raw) { current.remove(); return; }
  const entry = { role: 'assistant', text: raw };
  if (uuid) entry.uuid = uuid;
  history.push(entry);
  renderBot(current, raw, thinking);
}
function addMsg(cls, text) {
  log.classList.add('has');
  const el = document.createElement('div');
  el.className = 'msg ' + cls;
  if (text != null) el.textContent = text;
  log.appendChild(el);
  return el;
}
function addUserMsg(text, imgs, count) {
  const user = addMsg('user', null);
  if (imgs && imgs.length) {
    const t = document.createElement('div');
    t.className = 'thumbs';
    imgs.forEach((im) => {
      if (isImage(im)) { const i = document.createElement('img'); i.src = im.url; t.appendChild(i); }
      else { const f = document.createElement('span'); f.className = 'filetag'; f.innerHTML = icon('file'); f.append(im.name); t.appendChild(f); }
    });
    user.appendChild(t);
  } else if (count) {
    const n = document.createElement('div');
    n.className = 'imgnote';
    n.textContent = count === 1 ? '[1 attachment]' : '[' + count + ' attachments]';
    user.appendChild(n);
  }
  user.appendChild(document.createTextNode(text));
  return user;
}
function setBusy(v) {
  busy = v;
  send.innerHTML = icon(v ? 'stop' : 'up');
  send.classList.toggle('stop', v);
  if (v) refreshTurnActions();
}
function scrollEnd() { log.scrollTop = log.scrollHeight; }
const saveChat = () => { if (history.length) window.bar.saveChat(history); };

function sendMessage(text, imgs, opts) {
  const prior = history.map(({ role, text: t, images: n }) => ({ role, text: t, images: n || 0 }));
  addUserMsg(text, imgs);
  history.push({ role: 'user', text, images: imgs.length });
  lastSent = { text, images: imgs };
  enterChat();
  current = addMsg('bot dots', null);
  raw = ''; thinking = '';
  setBusy(true);
  setTitle();
  window.bar.ask(text, imgs.filter(isImage).map(({ mediaType, data }) => ({ mediaType, data })), {
    prior,
    files: imgs.filter((a) => !isImage(a)).map(({ name, mediaType, data, text: t }) => ({ name, mediaType, data, text: t })),
    ...opts,
  });
  fit(); scrollEnd();
}

// Remove the last question and everything after it (page and history). Returns that question.
function cutLastTurn() {
  const users = log.querySelectorAll('.msg.user');
  let n = users[users.length - 1];
  while (n) { const next = n.nextSibling; n.remove(); n = next; }
  let i = history.length - 1;
  while (i >= 0 && history[i].role !== 'user') i--;
  if (i < 0) return null;
  const turn = history[i];
  history = history.slice(0, i);
  return turn;
}
// Where the Claude session should continue from after cutLastTurn().
function forkPoint() {
  const last = history[history.length - 1];
  if (!last) return { fresh: true }; // it was the first message: start a new session
  if (last.role === 'assistant' && last.uuid) return { resumeAt: last.uuid };
  return { fresh: true }; // cannot fork exactly: start a new session with the transcript
}
const sameTurn = (turn) => lastSent && lastSent.text === turn.text && lastSent.images.length === turn.images;

function regenerate() {
  if (busy) return;
  const turn = cutLastTurn();
  if (!turn) return;
  const imgs = sameTurn(turn) ? lastSent.images : [];
  if (turn.images && !imgs.length) flash('Its attachments were not saved, so they are not resent');
  sendMessage(turn.text, imgs, forkPoint());
}

function startEdit() {
  if (busy) return;
  const turn = [...history].reverse().find((h) => h.role === 'user');
  if (!turn) return;
  editing = true;
  document.body.classList.add('editing');
  input.value = turn.text;
  images = sameTurn(turn) ? lastSent.images.slice() : [];
  if (turn.images && !images.length) flash('Its attachments were not saved; add them again if needed');
  renderChips();
  refreshTurnActions();
  autosize();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function endEdit(clear) {
  editing = false;
  document.body.classList.remove('editing');
  if (clear) { input.value = ''; images = []; renderChips(); autosize(); }
  refreshTurnActions();
}

function submit() {
  const text = input.value.trim();
  if (engine === 'web') { // a real claude.ai chat
    if (!text) return;
    input.value = '';
    autosize();
    enterChat();
    window.bar.webAsk(text);
    return;
  }
  if ((!text && !images.length) || busy) return;
  let opts = {};
  if (editing) {
    endEdit(false);
    cutLastTurn();
    opts = forkPoint();
  }
  const imgs = images;
  images = [];
  renderChips();
  input.value = '';
  autosize();
  sendMessage(text, imgs, opts);
}

// ---------- images ----------
function renderChips() {
  const box = $('chips');
  box.innerHTML = '';
  images.forEach((im, i) => {
    const c = document.createElement('div');
    if (isImage(im)) {
      c.className = 'chip';
      const img = document.createElement('img');
      img.src = im.url;
      c.appendChild(img);
    } else {
      c.className = 'chip file';
      c.innerHTML = icon('file');
      const n = document.createElement('span');
      n.textContent = im.name;
      c.appendChild(n);
    }
    const x = document.createElement('button');
    x.innerHTML = icon('x');
    x.title = 'Remove';
    x.addEventListener('click', () => { images.splice(i, 1); renderChips(); input.focus(); });
    c.appendChild(x);
    box.appendChild(c);
  });
  box.classList.toggle('has', images.length > 0);
  fit();
}
function addFile(file) {
  if (!file) return;
  if (engine === 'web') return flash('Switch to Quick to attach files here');
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const text = !image && !pdf && (/^text\//.test(file.type) || TEXT_FILE.test(file.name));
  if (!image && !pdf && !text) return flash("Can't attach that kind of file. Try an image, PDF or text file");
  if (images.length + pendingFiles >= MAX_IMAGES) return flash('Up to ' + MAX_IMAGES + ' attachments per message');
  if (image && file.size > MAX_BYTES) return flash('Image is over 5 MB');
  if (pdf && file.size > MAX_PDF) return flash('PDF is over 20 MB');
  if (text && file.size > MAX_TEXT) return flash('Text file is over 1 MB');
  const reader = new FileReader();
  pendingFiles++;
  reader.onerror = () => { pendingFiles--; flash("Couldn't read that file"); };
  reader.onload = () => {
    pendingFiles--;
    if (text) images.push({ name: file.name, text: String(reader.result) });
    else {
      const url = String(reader.result);
      const data = url.split(',')[1];
      if (pdf) images.push({ name: file.name, mediaType: 'application/pdf', data });
      else images.push({ mediaType: file.type, data, url });
    }
    renderChips();
    input.focus();
  };
  if (text) reader.readAsText(file);
  else reader.readAsDataURL(file);
}
let flashTimer = null;
function flash(m) {
  $('notice').textContent = m;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ($('notice').textContent = ''), 3000);
}
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  fit();
}

// ---------- saved chats ----------
const histOpen = () => document.body.classList.contains('hist');
function when(t) {
  const d = new Date(t), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
async function openHistory() {
  if (engine === 'web') return window.bar.webOpen('/recents'), enterChat();
  if (histOpen() && !document.body.classList.contains('settings')) return closeHistory();
  closeMenu();
  histFromCompact = !chatMode;
  enterChat();
  document.body.classList.remove('settings');
  document.body.classList.add('hist');
  const panel = $('panel');
  panel.innerHTML = '<div class="phead">History</div>';
  const list = await window.bar.listChats();
  if (!list.length) {
    const p = document.createElement('div');
    p.className = 'pempty';
    p.textContent = 'No saved chats yet. Chats are saved after each reply.';
    panel.appendChild(p);
    return;
  }
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'pitem';
    const t = document.createElement('span');
    t.className = 'ptitle';
    t.textContent = c.title;
    const w = document.createElement('span');
    w.className = 'pwhen';
    w.textContent = when(c.updated);
    let armed = null;
    const del = actBtn('x', 'Delete this chat', async (b) => {
      if (!armed) { // first click asks, second click deletes
        b.textContent = 'Delete?';
        b.classList.add('armed');
        armed = setTimeout(() => { armed = null; b.innerHTML = icon('x'); b.classList.remove('armed'); }, 3000);
        return;
      }
      clearTimeout(armed);
      if (await window.bar.deleteChat(c.id)) row.remove();
      if (!panel.querySelector('.pitem')) {
        const p = document.createElement('div');
        p.className = 'pempty';
        p.textContent = 'No saved chats.';
        panel.appendChild(p);
      }
    }, 'pdel');
    row.append(t, w, del);
    row.addEventListener('click', () => openSaved(c.id));
    panel.appendChild(row);
  }
}
function closeHistory() {
  if (!histOpen()) return;
  document.body.classList.remove('hist', 'settings');
  if (!history.length && histFromCompact) leaveChat();
  input.focus();
}
async function openSaved(id) {
  if (busy) { // let the stopped reply finish saving first, or it would land in the chat being opened
    const stopped = new Promise((r) => (doneWaiter = r));
    window.bar.stop();
    await stopped;
  }
  const chat = await window.bar.openChat(id);
  if (!chat) return flash('Could not open that chat');
  clearChat();
  history = chat.messages;
  for (const m of history) {
    if (m.role === 'user') addUserMsg(m.text, null, m.images);
    else renderBot(addMsg('bot', null), m.text);
  }
  if (!history.length) log.classList.remove('has');
  document.body.classList.remove('hist', 'settings');
  setTitle();
  refreshTurnActions();
  scrollEnd();
  input.focus();
}
function clearChat() {
  log.innerHTML = ''; log.classList.remove('has');
  if (editing) endEdit(true);
  images = []; renderChips();
  history = []; lastSent = null;
  current = null; raw = ''; thinking = ''; setBusy(false);
  setTitle();
}

// ---------- settings ----------
function openSettings() {
  closeMenu();
  histFromCompact = !chatMode;
  enterChat();
  document.body.classList.add('hist', 'settings');
  const panel = $('panel');
  panel.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'phead';
  head.textContent = 'Settings';
  const about = document.createElement('div');
  about.className = 'setting';
  about.innerHTML = '<label for="about">About you</label><textarea id="about" placeholder="I prefer short answers with examples."></textarea><p>Sent to Claude in Quick chats. Claude.ai uses its own settings and memory.</p>';
  const keys = document.createElement('div');
  keys.className = 'setting';
  const rows = [[shortcuts.shortcut, 'Show or hide'], [shortcuts.screenshotShortcut, 'Screenshot and ask'], ['Cmd+N', 'New chat'], ['Esc', 'Hide']];
  keys.innerHTML = '<label>Shortcuts</label><div class="keys"></div>';
  rows.forEach(([k, what]) => {
    const a = document.createElement('span'); a.textContent = String(k || '').replace('Alt', 'Option').replace(/\+/g, ' + ');
    const b = document.createElement('span'); b.textContent = what;
    keys.lastChild.append(a, b);
  });
  panel.append(head, about, keys);
  const box = $('about');
  box.value = aboutText;
  box.addEventListener('input', () => { aboutText = box.value; window.bar.setOption('about', aboutText); });
}

// ---------- pop-up menus ----------
let openPop = null;
const menu = $('menu');
function closeMenu() {
  if (!openPop) return;
  openPop.hidden = true;
  openPop = null;
  fit();
}
function togglePop(el) {
  const was = openPop === el;
  closeMenu();
  if (was) return;
  el.hidden = false;
  openPop = el;
  fit();
}
$('more').addEventListener('click', async (e) => {
  e.stopPropagation();
  if (openPop === menu) return closeMenu();
  $('m-code').disabled = busy || !(await window.bar.hasSession());
  $('m-chat').disabled = !history.length;
  togglePop(menu);
});
document.addEventListener('click', (e) => { if (openPop && !e.target.closest('.pop')) closeMenu(); });
$('m-settings').addEventListener('click', openSettings);
$('m-code').addEventListener('click', () => { closeMenu(); window.bar.continueInCode(); });
$('m-chat').addEventListener('click', () => { closeMenu(); if (history.length) window.bar.handoff(history); });
$('open').addEventListener('click', () => window.bar.webOpenApp());

$('plus').addEventListener('click', (e) => { e.stopPropagation(); togglePop($('plusmenu')); });
$('p-file').addEventListener('click', () => { closeMenu(); $('filepick').click(); });
$('filepick').addEventListener('change', (e) => { [...e.target.files].forEach(addFile); e.target.value = ''; });
$('p-shot').addEventListener('click', () => { closeMenu(); window.bar.screenshot(); });
function setConnectors(on) {
  $('conn').classList.toggle('on', on);
  $('p-conn').classList.toggle('picked', on);
}
const toggleConnectors = () => {
  const on = !$('conn').classList.contains('on');
  setConnectors(on);
  window.bar.setOption('connectors', on);
  closeMenu();
  input.focus();
};
$('p-conn').addEventListener('click', toggleConnectors);
$('conn').addEventListener('click', toggleConnectors);

const MODEL_NAMES = { '': 'Default', sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' };
const EFFORT_NAMES = { '': 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
let model = '', effort = '';
function drawModelMenu() {
  const box = $('modelmenu');
  box.innerHTML = '';
  $('modelname').textContent = MODEL_NAMES[model] + (effort ? ' · ' + EFFORT_NAMES[effort] : '');
  const group = (label, names, value, pick) => {
    const l = document.createElement('div');
    l.className = 'plabel';
    l.textContent = label;
    box.appendChild(l);
    for (const [v, name] of Object.entries(names)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.insertAdjacentHTML('beforeend', '<svg class="ic tick"><use href="#i-check"/></svg>');
      b.classList.toggle('picked', v === value);
      b.addEventListener('click', () => { pick(v); drawModelMenu(); closeMenu(); input.focus(); });
      box.appendChild(b);
    }
  };
  group('Model', MODEL_NAMES, model, (v) => { model = v; window.bar.setOption('model', v); });
  const sep = document.createElement('div');
  sep.className = 'sep';
  box.appendChild(sep);
  group('Effort', EFFORT_NAMES, effort, (v) => { effort = v; window.bar.setOption('effort', v); });
}
$('modelbtn').addEventListener('click', (e) => { e.stopPropagation(); togglePop($('modelmenu')); });

// ---------- Quick or Claude.ai ----------
function setTitle(text) {
  if (text === undefined) {
    const first = history.find((h) => h.role === 'user');
    text = engine === 'web' ? (chatMode ? webTitle : '') : first ? first.text : '';
  }
  $('title').textContent = text;
}
function showEngine(e) {
  engine = e;
  document.body.classList.toggle('web', e === 'web');
  document.querySelectorAll('#engine button').forEach((b) => b.classList.toggle('on', b.dataset.engine === e));
  input.placeholder = e === 'web' ? 'Start a chat on Claude.ai' : 'How can I help you today?';
  $('hist').title = e === 'web' ? 'Your Claude.ai chats' : 'History';
  setTitle();
  fit();
}
async function switchEngine(e) {
  if (e === engine) return;
  closeMenu();
  closeHistory();
  showEngine(e);
  const webShowing = await window.bar.setEngine(e);
  if (e === 'web') { if (webShowing) enterChat(); else input.focus(); return; }
  if (history.length) enterChat();
  else if (chatMode) leaveChat();
  input.focus();
}
document.querySelectorAll('#engine button').forEach((b) => b.addEventListener('click', () => switchEngine(b.dataset.engine)));

// ---------- wiring ----------
send.addEventListener('click', () => (busy ? window.bar.stop() : submit()));
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
});
document.addEventListener('keydown', (e) => {
  // Esc while an input method is composing text only cancels that, it does not hide the bar
  if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) {
    if (openPop) closeMenu();
    else if (editing) endEdit(true);
    else if (histOpen()) closeHistory();
    else window.bar.hide();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); window.bar.newChat(); }
});
$('close').addEventListener('click', () => window.bar.hide());
$('new').addEventListener('click', () => window.bar.newChat());
$('hist').addEventListener('click', openHistory);
$('pin').addEventListener('click', (e) => {
  const on = e.currentTarget.classList.toggle('on');
  window.bar.pin(on);
});

document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length || e.target.id === 'about') return; // plain text paste continues as normal
  e.preventDefault();
  files.forEach(addFile);
});
const card = $('card');
card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop'); });
card.addEventListener('dragleave', () => card.classList.remove('drop'));
card.addEventListener('drop', (e) => {
  e.preventDefault(); card.classList.remove('drop');
  [...e.dataTransfer.files].forEach(addFile);
});
function setWeb(on) {
  const b = $('web');
  b.classList.toggle('on', on);
  b.title = on ? 'Web search on: Claude can look things up online' : 'Web search off: Claude answers from what it knows';
}
$('web').addEventListener('click', () => {
  const on = !$('web').classList.contains('on');
  setWeb(on);
  window.bar.setOption('webSearch', on);
  input.focus();
});
window.bar.onConfig((c) => {
  model = c.model || '';
  effort = c.effort || '';
  drawModelMenu();
  setWeb(c.webSearch !== false);
  setConnectors(!!c.connectors);
  aboutText = c.about || '';
  shortcuts = c;
  $('p-shot-key').textContent = String(c.screenshotShortcut || '').replace('Alt', 'Option').replace(/\+/g, ' + ');
  if (c.webShowing) { chatMode = true; document.body.classList.add('chat'); }
  showEngine(c.engine === 'web' ? 'web' : 'quick');
});
function pct(w) { return Math.round((w.used || 0) * 100) + '%'; }
function resetTime(w) {
  if (!w.resetsAt) return '';
  return ', resets ' + new Date(w.resetsAt * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
window.bar.onUsage((u) => {
  // show whichever limit is closer to running out
  const near = [u.fiveHour && ['5h', u.fiveHour], u.week && ['Week', u.week]].filter(Boolean).sort((a, b) => b[1].used - a[1].used)[0];
  if (!near) return;
  const el = $('usage');
  el.textContent = near[0] + ' ' + pct(near[1]);
  el.classList.toggle('high', near[1].used >= 0.8);
  el.title = [u.fiveHour && '5-hour limit: ' + pct(u.fiveHour) + ' used' + resetTime(u.fiveHour), u.week && 'Weekly limit: ' + pct(u.week) + ' used' + resetTime(u.week)].filter(Boolean).join('\n');
});
window.bar.onAttach((a) => {
  if (images.length >= MAX_IMAGES) return flash('Up to ' + MAX_IMAGES + ' attachments per message');
  images.push({ mediaType: a.mediaType, data: a.data, url: 'data:' + a.mediaType + ';base64,' + a.data });
  renderChips();
  input.focus();
});
window.bar.onEngine((e) => { showEngine(e); chatMode = true; document.body.classList.add('chat'); });
window.bar.onWebState((s) => {
  if (engine !== 'web') return;
  webTitle = String(s.title || '').replace(/\s*[-|]\s*Claude(\.ai)?\s*$/i, '').replace(/^Claude$/, '');
  setTitle(webTitle);
  if (!s.signIn && /^Sign in/.test($('notice').textContent)) $('notice').textContent = '';
});
window.bar.onThinking((t) => {
  if (!current) return;
  current.classList.remove('dots');
  thinking += t;
  scheduleDraw();
});

// At most one redraw per frame: long replies with maths would otherwise lag.
let drawQueued = false;
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; if (current) drawStreaming(); });
}
function drawStreaming() {
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  current.innerHTML = render(raw, { final: false });
  if (thinking) current.prepend(thinkBlock(thinking, !raw));
  if (status) {
    const s = document.createElement('div');
    s.className = 'status';
    s.textContent = status;
    current.appendChild(s);
  }
  if (stick) scrollEnd();
}
window.bar.onDelta((t) => {
  if (!current) return;
  current.classList.remove('dots');
  raw += t;
  if (t.trim()) status = ''; // the answer is coming in again
  scheduleDraw();
});
window.bar.onStatus((s) => {
  if (!current || !s) return;
  current.classList.remove('dots');
  if (s.tool === 'search') status = 'Searching the web: ' + s.query;
  else if (s.tool === 'fetch') { let h = s.url; try { h = new URL(s.url).hostname; } catch (_) {} status = 'Reading ' + h; }
  else if (s.tool === 'connector') status = 'Looking in ' + s.name;
  scheduleDraw();
});
window.bar.onDone((p) => {
  const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const empty = p && current && !raw; // p is empty when you pressed Stop
  finishMessage(p && p.uuid);
  current = null;
  if (empty) addMsg('err', "Claude didn't send a reply. Try again.");
  setBusy(false); saveChat(); refreshTurnActions(); fit();
  if (atEnd) scrollEnd();
  input.focus();
  if (doneWaiter) { doneWaiter(); doneWaiter = null; }
});
window.bar.onError((m) => {
  finishMessage();
  current = null;
  addMsg('err', m);
  setBusy(false); saveChat(); refreshTurnActions(); fit(); scrollEnd();
});
window.bar.onReset((r) => {
  if (r && r.webOnly) { // a new Claude.ai chat: any Quick chat stays as it was
    chatMode = false; document.body.classList.remove('chat');
    $('notice').textContent = '';
    webTitle = '';
    setTitle('');
    fit(); input.focus();
    return;
  }
  clearChat();
  closeMenu();
  document.body.classList.remove('hist', 'settings');
  $('notice').textContent = '';
  chatMode = false; document.body.classList.remove('chat');
  fit(); input.focus();
});
window.bar.onFocus(() => { input.focus(); input.select(); fit(); });
window.bar.onNotice((m) => { $('notice').textContent = m; });
send.innerHTML = icon('up');
// links open in the default browser (main process handles the navigation)
log.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (a) { e.preventDefault(); window.open(a.href); }
});

// no logo.png yet? show a plain coloured dot instead
$('logo').addEventListener('error', (e) => { e.target.removeAttribute('src'); e.target.classList.add('fallback'); });

fit();
