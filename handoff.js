'use strict';
// Builds the text used to continue a chat-bar conversation in the Claude app.
// The Claude app's deep link (claude://claude.ai/new?q=...) opens a NEW chat with the
// prompt box pre-filled, so the conversation travels as a transcript.

const HEAD =
  'Continuing a conversation from my floating chat bar. Here is the transcript so far. ' +
  'Please carry on from here; my next message follows.\n\n';

function clean(text) {
  return String(text || '')
    .replace(/```widget[\s\S]*?(```|$)/g, '[interactive view omitted]')
    .trim();
}

function turnText(h) {
  const who = h.role === 'user' ? 'Me' : 'Claude';
  const imgs = h.images ? ` [${h.images} attachment(s) not included]` : '';
  return `${who}: ${clean(h.text)}${imgs}`;
}

/**
 * @param history  [{role: 'user'|'assistant', text, images?}]
 * @param opts     { maxChars, maxEncoded }  limits for the pre-filled prompt
 * @returns { full, q, truncated }  full = whole transcript (for the clipboard), q = what fits in the link
 */
function buildHandoff(history, opts) {
  const maxChars = (opts && opts.maxChars) || 12000; // the app truncates q at ~14,000 characters
  const maxEncoded = (opts && opts.maxEncoded) || 30000; // keep the URL itself a sensible length
  const turns = history.filter((h) => h && (h.text || h.images)).map(turnText);
  const full = HEAD + turns.join('\n\n');

  const fits = (s) => s.length <= maxChars && encodeURIComponent(s).length <= maxEncoded;
  let start = 0;
  const make = () => HEAD + (start > 0 ? '[Earlier messages omitted]\n\n' : '') + turns.slice(start).join('\n\n');
  while (start < turns.length - 1 && !fits(make())) start++;

  let q = make();
  let truncated = start > 0;
  while (!fits(q) && q.length > HEAD.length + 50) {
    // a single very long turn: keep its start and the end marker
    q = q.slice(0, Math.floor(q.length * 0.9)) + '\n[truncated]';
    truncated = true;
  }
  return { full, q, truncated };
}

function deepLink(q) {
  return 'claude://claude.ai/new?q=' + encodeURIComponent(q);
}

module.exports = { buildHandoff, deepLink };
