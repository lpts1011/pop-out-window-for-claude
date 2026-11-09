'use strict';
// Tests the saved chat history store (chats.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createStore, titleOf } = require('../chats');

const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chats-')), 'chats');
const store = createStore(dir);

assert.deepStrictEqual(store.list(), [], 'no folder yet: empty list, no crash');

const id = store.newId();
const sid = '0744e866-0370-40c3-bf5a-d16a97be6cbb';
const saved = store.save({
  id,
  sessionId: sid,
  messages: [
    { role: 'user', text: '  What is   the derivative of x^2?  ', images: 1 },
    { role: 'assistant', text: '$2x$', uuid: 'd541f20b-d188-4452-b4ec-8c1234dab314', el: {} },
    { role: 'hacker', text: 'x', uuid: 'not-a-uuid' },
  ],
});
assert.strictEqual(saved.title, 'What is the derivative of x^2?');
const back = store.load(id);
assert.strictEqual(back.sessionId, sid);
assert.strictEqual(back.messages.length, 3);
assert.strictEqual(back.messages[1].uuid, 'd541f20b-d188-4452-b4ec-8c1234dab314', 'reply ids are kept for Retry');
assert.strictEqual(back.messages[2].role, 'assistant', 'unknown roles are cleaned');
assert.ok(!('uuid' in back.messages[2]), 'bad ids are dropped');
assert.ok(!('el' in back.messages[1]), 'only known fields are saved');

// saving again keeps the created time and moves it to the top of the list
const id2 = store.newId();
store.save({ id: id2, sessionId: 'nope', messages: [{ role: 'user', text: 'second' }] });
assert.strictEqual(store.load(id2).sessionId, null, 'bad session ids are dropped');
const created = store.load(id).created;
store.save({ id, sessionId: sid, messages: back.messages });
assert.strictEqual(store.load(id).created, created);
const list = store.list();
assert.strictEqual(list.length, 2);
assert.strictEqual(list[0].id, id, 'newest first');

// unsafe ids are refused (no reading or deleting files outside the folder)
assert.strictEqual(store.load('../config'), null);
assert.strictEqual(store.remove('../config'), false);
assert.throws(() => store.save({ id: '../x', messages: [] }));

assert.ok(store.remove(id2));
assert.strictEqual(store.list().length, 1);
fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
assert.strictEqual(store.list().length, 1, 'a broken file is skipped');

assert.strictEqual(titleOf([{ role: 'user', text: '', images: 2 }]), 'Attachment');
assert.strictEqual(titleOf([{ role: 'user', text: 'a'.repeat(100) }]).length, 60);

console.log('chats tests passed');
