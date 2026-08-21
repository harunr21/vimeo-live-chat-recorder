const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const contentSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8');

test('a player-only frame reports an already-ended video while waiting for chat', () => {
  const sentMessages = [];
  const document = {
    title: 'Test yayını',
    body: { innerText: '' },
    querySelector(selector) {
      return selector === 'video' ? { ended: true } : null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const window = {
    parent: {},
    addEventListener() {}
  };
  const chrome = {
    runtime: {
      sendMessage(message) {
        sentMessages.push(message);
        return Promise.resolve({ success: true });
      },
      onMessage: { addListener() {} }
    }
  };

  vm.runInNewContext(contentSource, {
    chrome,
    console,
    Date,
    document,
    Element: class Element {},
    HTMLVideoElement: class HTMLVideoElement {},
    location: { href: 'https://player.vimeo.com/video/1' },
    MutationObserver: class MutationObserver {},
    setInterval() { return 1; },
    setTimeout(callback) { callback(); return 1; },
    WeakSet,
    window
  });

  assert.ok(sentMessages.some(message => message.type === 'LIVE_END_DETECTED'));
  assert.ok(sentMessages.some(message => message.type === 'PERSIST_RECORDING' && message.recording.status === 'finished'));
});
