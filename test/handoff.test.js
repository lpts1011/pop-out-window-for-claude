'use strict';
const assert = require('assert');
const { buildHandoff, deepLink } = require('../handoff');

let r = buildHandoff([
  { role: 'user', text: 'Find r1+r2', images: 1 },
  { role: 'assistant', text: 'Answer $\\frac{32}{75}$\n```widget\n<b>big html</b>\n```' },
]);
assert.ok(r.q.includes('Me: Find r1+r2 [1 attachment(s) not included]'));
assert.ok(r.q.includes('\\frac{32}{75}') && !r.q.includes('big html') && r.q.includes('[interactive view omitted]'));
assert.strictEqual(r.truncated, false);

// long chats keep the most recent turns and stay inside the limits
const long = [];
for (let i = 0; i < 80; i++) long.push({ role: i % 2 ? 'assistant' : 'user', text: 'Turn ' + i + ' end ' + 'math '.repeat(200) });
r = buildHandoff(long);
assert.ok(r.q.length <= 12000 && encodeURIComponent(r.q).length <= 30000, 'fits the link');
assert.ok(r.truncated && r.q.includes('[Earlier messages omitted]') && r.q.includes('Turn 79 end'), 'keeps the newest turns');
assert.ok(r.full.includes('Turn 0 end'), 'clipboard copy has everything');
assert.ok(deepLink('a b&c').startsWith('claude://claude.ai/new?q=a%20b%26c'));
console.log('handoff tests passed');
