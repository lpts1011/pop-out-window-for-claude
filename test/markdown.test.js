'use strict';
const assert = require('assert');
globalThis.katex = require('../renderer/vendor/katex/katex.min.js');
const Md = require('../renderer/markdown.js');

let h = Md.render('$$\\frac{82}{27}$$ and $x^2$ cost $5 and $6');
assert.strictEqual((h.match(/class="katex"/g) || []).length, 2, 'two formulas typeset');
assert.ok(h.includes('$5 and $6'), 'currency left alone');

h = Md.render('<script>alert(1)</script> **bold**');
assert.ok(!h.includes('<script>') && h.includes('<strong>bold</strong>'), 'HTML escaped');

const widgets = [];
h = Md.render('```widget\n<b>x</b>\n```', { final: true, widgets });
assert.deepStrictEqual(widgets, ['<b>x</b>\n']);
assert.ok(h.includes('widget-slot'));
assert.ok(Md.render('```widget\n<b>x', { final: false }).includes('widget-pending'), 'unfinished widget waits');

h = Md.render('| a | b |\n|---|---|\n| 1 | 2 |');
assert.ok(h.includes('<table>') && h.includes('<td>2</td>'));
// numbered items separated by blank lines keep counting
h = Md.render('1. one\n\n2. two\n\n3. three');
assert.ok(h.includes('<ol start="2">') && h.includes('<ol start="3">') && !h.includes('<ol start="1">'));

// a web address can't break out of the link
h = Md.render('[x](https://a.com/"onmouseover="alert(1))');
assert.ok(!/<a [^>]*onmouseover/.test(h), h);
h = Md.render('see https://a.com/b?c=1&d=2. And [s](https://en.wikipedia.org/wiki/A_(b))');
assert.ok(h.includes('<a href="https://a.com/b?c=1&amp;d=2">') && h.includes('wiki/A_(b)">s</a>'), h);
assert.strictEqual((Md.render('[s](https://a.com)').match(/<a /g) || []).length, 1, 'a link is not linked twice');

// stars used as maths, and escaped characters
assert.ok(!Md.render('2 * 3 * 4').includes('<em>'));
assert.ok(Md.render('plain *emphasis* plain').includes('<em>emphasis</em>'));
h = Md.render('price \\$5 and \\*stars\\*');
assert.ok(h.includes('price $5') && h.includes('*stars*') && !h.includes('\\'), h);

// a table with no outer pipes
assert.ok(Md.render('a | b\n---|---\n1 | 2').includes('<td>2</td>'));
console.log('markdown tests passed');
