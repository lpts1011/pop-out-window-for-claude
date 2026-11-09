'use strict';
// Tests claude.js against a fake `claude` executable (no login or network needed).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { ask } = require('../claude');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakeclaude-'));
const fake = path.join(dir, 'claude');
const log = path.join(dir, 'log.json');
fs.writeFileSync(
  fake,
  `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  require('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), key: process.env.ANTHROPIC_API_KEY || null, input }));
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  for (const t of ['Hel', 'lo ', 'there']) out({ type: 'stream_event', session_id: 'sess-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
  out({ type: 'assistant', session_id: 'sess-1', uuid: 'aaaaaaaa-1111-2222-3333-444444444444', message: { content: [{ type: 'text', text: 'Hello there' }] } });
  out({ type: 'result', session_id: 'sess-1', is_error: false, result: 'Hello there' });
});
`,
  { mode: 0o755 }
);

function run(config, sessionId, images, extra) {
  return new Promise((resolve) => {
    const deltas = [];
    let session = null;
    ask({
      prompt: 'hi there',
      images,
      sessionId,
      ...extra,
      config: { claudePath: fake, authMode: 'plan', apiKey: '', model: '', systemPrompt: 'be brief', ...config },
      handlers: {
        onText: (t) => deltas.push(t),
        onSession: (id) => (session = id),
        onDone: (r) => resolve({ deltas, session, r, seen: JSON.parse(fs.readFileSync(log, 'utf8')) }),
        onError: (m) => resolve({ error: m }),
      },
    });
  });
}

(async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-should-be-stripped';

  let res = await run({});
  assert.deepStrictEqual(res.deltas, ['Hel', 'lo ', 'there'], 'streams deltas once, no duplicates');
  assert.strictEqual(res.session, 'sess-1');
  assert.strictEqual(res.r.text, 'Hello there');
  assert.strictEqual(res.seen.input, 'hi there', 'prompt sent on stdin');
  assert.strictEqual(res.seen.key, null, 'plan mode must not leak the API key');
  assert.ok(res.seen.args.includes('--tools') && res.seen.args.includes('--include-partial-messages'));
  assert.ok(!res.seen.args.includes('--resume'));

  res = await run({}, 'sess-1');
  const i = res.seen.args.indexOf('--resume');
  assert.ok(i >= 0 && res.seen.args[i + 1] === 'sess-1', 'follow-up turns resume the session');

  res = await run({ authMode: 'apikey', apiKey: 'sk-mine', model: 'sonnet' });
  assert.strictEqual(res.seen.key, 'sk-mine', 'apikey mode passes the key');
  assert.ok(res.seen.args.includes('--model'));

  res = await run({ model: 'opus', effort: 'high' });
  const a = res.seen.args;
  assert.strictEqual(a[a.indexOf('--model') + 1], 'opus');
  assert.strictEqual(a[a.indexOf('--effort') + 1], 'high');

  res = await run({}, null, [{ mediaType: 'image/png', data: 'AAAA' }]);
  assert.ok(res.seen.args.includes('--input-format') && res.seen.args.includes('stream-json'), 'images use stream-json input');
  const sent = JSON.parse(res.seen.input);
  assert.strictEqual(sent.message.content[0].type, 'image');
  assert.strictEqual(sent.message.content[0].source.data, 'AAAA');
  assert.strictEqual(sent.message.content[1].text, 'hi there');

  assert.strictEqual(res.r.uuid, 'aaaaaaaa-1111-2222-3333-444444444444', 'reports the reply id');
  assert.ok(!res.seen.args.includes('--fork-session'));

  res = await run({}, 'sess-1', undefined, { resumeAt: 'bbbbbbbb-1111-2222-3333-444444444444', cwd: dir });
  const ra = res.seen.args;
  assert.strictEqual(ra[ra.indexOf('--resume') + 1], 'sess-1');
  assert.strictEqual(ra[ra.indexOf('--resume-session-at') + 1], 'bbbbbbbb-1111-2222-3333-444444444444', 'regenerate forks at the earlier reply');
  assert.ok(ra.includes('--fork-session'), 'regenerate never changes the original session');

  res = await run({}, null, undefined, { resumeAt: 'bbbbbbbb-1111-2222-3333-444444444444' });
  assert.ok(!res.seen.args.includes('--resume-session-at'), 'resumeAt is ignored without a session');

  res = await run({ claudePath: '/nonexistent/claude' });
  // falls back to PATH lookup; if no claude installed this must be a clean error, not a crash
  assert.ok(res.error || res.r);

  // web search: on by default, only the two web tools, never files or shell
  res = await run({});
  let wa = res.seen.args;
  assert.strictEqual(wa[wa.indexOf('--tools') + 1], 'WebSearch,WebFetch', 'web search is on by default');
  assert.strictEqual(wa[wa.indexOf('--allowedTools') + 1], 'WebSearch,WebFetch', 'web tools need no permission prompt');
  assert.ok(/WebSearch/.test(wa[wa.indexOf('--system-prompt') + 1]) && /be brief/.test(wa[wa.indexOf('--system-prompt') + 1]));
  res = await run({ webSearch: false });
  wa = res.seen.args;
  assert.strictEqual(wa[wa.indexOf('--tools') + 1], '', 'web off: no tools at all');
  assert.ok(!wa.includes('--allowedTools'));
  assert.ok(!/WebSearch/.test(wa[wa.indexOf('--system-prompt') + 1]));

  // speed and voice: no Claude Code prompt, skills or connector tools unless asked for
  res = await run({ about: 'I study maths' });
  wa = res.seen.args;
  assert.ok(wa.includes('--strict-mcp-config') && wa.includes('--disable-slash-commands'));
  assert.ok(!wa.includes('--append-system-prompt'), 'replaces the coding prompt instead of adding to it');
  const sysText = wa[wa.indexOf('--system-prompt') + 1];
  assert.ok(/I study maths/.test(sysText) && /Today is/.test(sysText), 'about you and the date reach Claude');

  // connectors: reading only
  res = await run({ connectors: true, webSearch: false });
  wa = res.seen.args;
  assert.ok(!wa.includes('--strict-mcp-config'), 'connectors load when switched on');
  const okTools = wa[wa.indexOf('--allowedTools') + 1].split(',');
  const noTools = wa[wa.indexOf('--disallowedTools') + 1].split(',');
  assert.ok(okTools.includes('mcp__claude_ai_Gmail__search_threads'));
  for (const t of ['send_message', 'reply', 'forward', 'trash_thread', 'create_draft']) {
    assert.ok(noTools.includes('mcp__claude_ai_Gmail__' + t), t + ' is blocked');
    assert.ok(!okTools.includes('mcp__claude_ai_Gmail__' + t), t + ' is not pre-approved');
  }
  assert.ok(!okTools.some((t) => noTools.includes(t)), 'no tool is both allowed and blocked');

  // PDFs go first, as document blocks
  res = await run({}, null, [{ mediaType: 'image/png', data: 'IMG' }], { files: [{ mediaType: 'application/pdf', data: 'PDF' }] });
  const docMsg = JSON.parse(res.seen.input).message.content;
  assert.deepStrictEqual(docMsg.map((b) => b.type), ['document', 'image', 'text']);
  assert.strictEqual(docMsg[0].source.data, 'PDF');

  // a reply that searches: status events, and text before and after the search is kept apart
  const webFake = path.join(dir, 'claude-web');
  fs.writeFileSync(webFake, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', () => {
  const out = (o) => console.log(JSON.stringify(o));
  const ev = (event) => out({ type: 'stream_event', session_id: 's', event });
  out({ type: 'system', subtype: 'init', session_id: 's' });
  out({ type: 'rate_limit_event', session_id: 's', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.04, resetsAt: 100 }, seven_day: { utilization: 0.61, resetsAt: 200 } } } });
  ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } });
  ev({ type: 'content_block_start', content_block: { type: 'text', text: '' } });
  ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me check.' } });
  out({ type: 'assistant', session_id: 's', uuid: 'u1', message: { content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', name: 'WebSearch', input: { query: 'node version' } }] } });
  out({ type: 'assistant', session_id: 's', uuid: 'u2', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://nodejs.org/en', prompt: 'x' } }] } });
  ev({ type: 'content_block_start', content_block: { type: 'text', text: '' } });
  ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'It is v26.' } });
  out({ type: 'assistant', session_id: 's', uuid: 'u3', message: { content: [{ type: 'text', text: 'It is v26.' }] } });
  out({ type: 'result', session_id: 's', is_error: false, result: 'It is v26.' });
});
`, { mode: 0o755 });
  const statuses = [];
  let usage = null, thought = '';
  const webRes = await new Promise((resolve) => ask({
    prompt: 'latest node?', sessionId: null,
    config: { claudePath: webFake, authMode: 'plan' },
    handlers: { onText: () => {}, onSession: () => {}, onStatus: (s) => statuses.push(s), onUsage: (u) => (usage = u), onThinking: (t) => (thought += t), onDone: resolve, onError: (m) => resolve({ error: m }) },
  }));
  assert.strictEqual(webRes.text, 'Let me check.\n\nIt is v26.', 'text blocks are separated');
  assert.strictEqual(webRes.uuid, 'u3', 'the last reply message id is kept');
  assert.deepStrictEqual(usage, { fiveHour: { used: 0.04, resetsAt: 100 }, week: { used: 0.61, resetsAt: 200 } }, 'plan usage is reported');
  assert.strictEqual(thought, 'hmm');
  assert.deepStrictEqual(statuses, [{ tool: 'search', query: 'node version' }, { tool: 'fetch', url: 'https://nodejs.org/en' }]);

  // a multi-byte character split across two chunks of output stays whole
  const splitFake = path.join(dir, 'claude-split');
  fs.writeFileSync(splitFake, `#!/usr/bin/env node
process.stdin.resume();
process.stdin.on('end', async () => {
  const line = Buffer.from(JSON.stringify({ type: 'stream_event', session_id: 's', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'café' } } }) + '\\n');
  const cut = line.indexOf(Buffer.from('é')) + 1;
  process.stdout.write(line.subarray(0, cut));
  await new Promise((r) => setTimeout(r, 80));
  process.stdout.write(line.subarray(cut));
  await new Promise((r) => setTimeout(r, 80));
  console.log(JSON.stringify({ type: 'result', session_id: 's', is_error: false, result: 'café' }));
});
`, { mode: 0o755 });
  const split = await new Promise((resolve) => ask({
    prompt: 'x', config: { claudePath: splitFake, authMode: 'plan' },
    handlers: { onText: () => {}, onSession: () => {}, onDone: resolve, onError: (m) => resolve({ error: m }) },
  }));
  assert.strictEqual(split.text, 'café', 'split characters are not corrupted');

  // after cancel, late output is ignored: it must not reach the next reply or change the session
  const lateFake = path.join(dir, 'claude-late');
  fs.writeFileSync(lateFake, `#!/usr/bin/env node
process.on('SIGTERM', () => {});
process.stdin.resume();
process.stdin.on('end', () => {
  const out = (o) => console.log(JSON.stringify(o));
  setTimeout(() => { out({ type: 'system', subtype: 'init', session_id: 'late' }); out({ type: 'stream_event', session_id: 'late', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'late' } } }); setTimeout(() => process.exit(0), 50); }, 150);
});
`, { mode: 0o755 });
  const late = [];
  const job = ask({ prompt: 'x', config: { claudePath: lateFake, authMode: 'plan' }, handlers: { onText: (t) => late.push(t), onSession: (i) => late.push(i), onDone: () => late.push('done'), onError: (m) => late.push(m) } });
  await new Promise((r) => setTimeout(r, 40));
  job.cancel();
  await new Promise((r) => setTimeout(r, 500));
  assert.deepStrictEqual(late, [], 'a cancelled reply stays silent');

  console.log('all runner tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
