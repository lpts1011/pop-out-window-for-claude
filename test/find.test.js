'use strict';
// Finding `claude` when the app is opened from Finder (tiny PATH, no .zshrc).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

function freshFind(home, shell) {
  process.env.HOME = home;
  process.env.SHELL = shell;
  delete require.cache[require.resolve('../claude')];
  return require('../claude').findClaude('');
}
const script = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '#!/bin/sh\n' + body + '\n', { mode: 0o755 });
};
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'findclaude-'));
const noShell = '/usr/bin/false';
const installed = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'].some((p) => fs.existsSync(p));

if (!installed) {
  // nvm, with several Node versions: the newest wins
  const nvm = path.join(root, 'a');
  for (const v of ['v9.0.0', 'v24.14.0', 'v18.2.1']) script(path.join(nvm, '.nvm/versions/node', v, 'bin/claude'), 'exit 0');
  assert.strictEqual(freshFind(nvm, noShell), path.join(nvm, '.nvm/versions/node/v24.14.0/bin/claude'));

  // only an interactive shell knows it, and its start-up files print other text first
  const viaShell = path.join(root, 'b');
  const bin = path.join(viaShell, 'tools/claude');
  script(bin, 'exit 0');
  const shell = path.join(root, 'fake-zsh');
  script(shell, `[ "$1" = "-ilc" ] || exit 1\necho "Welcome back"\necho "${bin}"`);
  assert.strictEqual(freshFind(viaShell, shell), bin);

  assert.strictEqual(freshFind(path.join(root, 'empty'), noShell), null, 'nothing installed gives a clean "not found"');
}
console.log('find tests passed');
