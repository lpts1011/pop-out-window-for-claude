'use strict';
// Small, safe Markdown + LaTeX renderer. Everything is HTML-escaped first; only
// the tags generated here (and KaTeX output) reach the page.
(function (root) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tok = (n) => '\u0001' + n + '\u0002';
  const TOKEN_ONLY = /^\u0001\d+\u0002$/;

  function math(tex, display) {
    try {
      return root.katex.renderToString(tex.trim(), {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      });
    } catch (_) {
      return '<code>' + esc(tex) + '</code>';
    }
  }

  function inline(s) {
    return s
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]*?[^*\s])\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
      // quotes are never allowed in a web address, so it cannot add attributes to the link
      .replace(/!?\[([^\]\n]+)\]\((https?:\/\/(?:[^()\s"']|\([^()\s"']*\))+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(:])(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?])/g, '$1<a href="$2">$2</a>');
  }

  function renderList(items) {
    let html = '';
    const stack = [];
    for (const it of items) {
      const tag = it.ordered ? 'ol' : 'ul';
      while (stack.length && it.indent < stack[stack.length - 1].indent) {
        html += '</li></' + stack.pop().tag + '>';
      }
      if (!stack.length || it.indent > stack[stack.length - 1].indent) {
        html += '<' + tag + (it.ordered && it.number !== 1 ? ' start="' + it.number + '"' : '') + '>';
        stack.push({ indent: it.indent, tag });
      } else {
        html += '</li>';
      }
      html += '<li>' + inline(it.text);
    }
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
  }

  const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  /**
   * render(text, { final, widgets })
   *  - final: the message is complete (widgets may be mounted)
   *  - widgets: array that receives the source of each ```widget block
   */
  function render(src, opts) {
    opts = opts || {};
    const store = [];
    const keep = (html) => (store.push(html), tok(store.length - 1));
    let text = String(src).replace(/\r\n/g, '\n');

    // 1. fenced code blocks (an unclosed fence, still streaming, runs to the end)
    text = text.replace(/```([\w+-]*)[^\n]*\n?([\s\S]*?)(```|$)/g, (m, lang, body, close) => {
      if (lang === 'widget') {
        if (opts.final && opts.widgets) {
          opts.widgets.push(body);
          return '\n' + keep('<div class="widget-slot" data-w="' + (opts.widgets.length - 1) + '"></div>') + '\n';
        }
        return '\n' + keep('<div class="widget-pending">Building interactive view…</div>') + '\n';
      }
      return '\n' + keep('<pre><code>' + esc(body.replace(/\n$/, '')) + '</code></pre>') + '\n';
    });

    // 2. inline code, then maths (so $ inside code is left alone)
    text = text.replace(/`([^`\n]+)`/g, (m, c) => keep('<code>' + esc(c) + '</code>'));
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => keep(math(t, true)));
    text = text.replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => keep(math(t, true)));
    text = text.replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => keep(math(t, false)));
    text = text.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g, (m, t) => keep(math(t, false)));
    // a backslash before punctuation means "show this character as it is"
    text = text.replace(/\\([*_`~$#|\[\]\\])/g, (m, c) => keep(esc(c)));

    // 3. block structure
    const lines = esc(text).split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push('<p>' + inline(para.join('<br>')) + '</p>');
      para = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (!line.trim()) { flush(); continue; }
      if (TOKEN_ONLY.test(line.trim())) { flush(); out.push(line.trim()); continue; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'); continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
      if (/^&gt;\s?/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^&gt;\s?/.test(lines[i])) q.push(lines[i++].replace(/^&gt;\s?/, ''));
        i--;
        out.push('<blockquote>' + inline(q.join('<br>')) + '</blockquote>');
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && SEP.test(lines[i + 1])) {
        flush();
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|')) rows.push(cells(lines[i++]));
        i--;
        out.push(
          '<table><thead><tr>' + head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>'
        );
        continue;
      }
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && (m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
          items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), number: parseInt(m[2], 10), text: m[3] });
          i++;
        }
        i--;
        out.push(renderList(items));
        continue;
      }
      para.push(line);
    }
    flush();

    // 4. put the saved pieces back
    let html = out.join('');
    for (let n = 0; n < 3 && /\u0001\d+\u0002/.test(html); n++) {
      html = html.replace(/\u0001(\d+)\u0002/g, (m, k) => store[+k] || '');
    }
    return html;
  }

  root.Md = { render, esc };
  if (typeof module !== 'undefined') module.exports = root.Md;
})(typeof window !== 'undefined' ? window : globalThis);
