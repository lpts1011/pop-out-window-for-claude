'use strict';
// Saved chat history: one JSON file per chat in a folder.
// A chat is { id, sessionId, title, created, updated, messages: [{ role, text, images, uuid? }] }.
// Image data is not kept, only how many images a message had.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID = /^[0-9a-z]{6,40}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_MESSAGES = 400;
const MAX_TEXT = 100000;

function cleanMessages(list) {
  return (Array.isArray(list) ? list : []).slice(-MAX_MESSAGES).map((h) => {
    const m = {
      role: h && h.role === 'user' ? 'user' : 'assistant',
      text: String((h && h.text) || '').slice(0, MAX_TEXT),
      images: Math.max(0, Math.min(Number(h && h.images) || 0, 4)),
    };
    if (h && typeof h.uuid === 'string' && UUID.test(h.uuid)) m.uuid = h.uuid;
    return m;
  });
}

function titleOf(messages) {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'Chat';
  const t = first.text.replace(/\s+/g, ' ').trim();
  if (!t) return first.images ? 'Attachment' : 'Chat';
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}

let lastStamp = 0;

function createStore(dir) {
  const file = (id) => path.join(dir, id + '.json');

  function load(id) {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    try {
      const c = JSON.parse(fs.readFileSync(file(id), 'utf8'));
      return { ...c, id, messages: cleanMessages(c.messages) };
    } catch (_) {
      return null;
    }
  }

  return {
    newId: () => Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),

    // Writes the chat (via a temporary file, so a crash cannot leave half a file). Returns the saved chat.
    save({ id, sessionId, messages }) {
      if (typeof id !== 'string' || !ID.test(id)) throw new Error('bad chat id');
      const clean = cleanMessages(messages);
      const old = load(id);
      const now = (lastStamp = Math.max(Date.now(), lastStamp + 1)); // two saves in one millisecond still sort correctly
      const chat = {
        id,
        sessionId: typeof sessionId === 'string' && UUID.test(sessionId) ? sessionId : null,
        title: titleOf(clean),
        created: (old && old.created) || now,
        updated: now,
        messages: clean,
      };
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file(id) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(chat));
      fs.renameSync(tmp, file(id));
      return chat;
    },

    load,

    // Newest first: [{ id, title, updated, count }]
    list(limit = 200) {
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch (_) {}
      return names
        .map((n) => load(n.slice(0, -5)))
        .filter(Boolean)
        .map((c) => ({ id: c.id, title: c.title || titleOf(c.messages), updated: c.updated || 0, count: c.messages.length }))
        .sort((a, b) => b.updated - a.updated)
        .slice(0, limit);
    },

    remove(id) {
      if (typeof id !== 'string' || !ID.test(id)) return false;
      try { fs.unlinkSync(file(id)); return true; } catch (_) { return false; }
    },
  };
}

module.exports = { createStore, cleanMessages, titleOf };
