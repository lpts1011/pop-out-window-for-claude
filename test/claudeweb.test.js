'use strict';
// Which sites may load inside the Claude.ai panel (everything else opens in the normal browser).
const assert = require('assert');
const { isPanelUrl } = require('../claudeweb');

for (const ok of ['https://claude.ai/new', 'https://www.anthropic.com/legal', 'https://accounts.google.com/o/oauth2', 'https://appleid.apple.com/auth']) {
  assert.ok(isPanelUrl(ok), ok);
}
for (const no of ['http://claude.ai/new', 'https://claude.ai.evil.com/', 'https://evilclaude.ai/', 'https://example.com/', 'file:///etc/passwd', 'not a url']) {
  assert.ok(!isPanelUrl(no), no);
}
assert.ok(isPanelUrl('http://127.0.0.1:9000/new', 'http://127.0.0.1:9000'), 'a test server counts when it is the base');
console.log('claudeweb tests passed');
