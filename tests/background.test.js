const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const backgroundSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createHarness(initialStorage = {}) {
  const storage = clone(initialStorage);
  const downloads = [];
  const broadcasts = [];
  let listener;
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: clone(storage[key]) };
          return clone(storage);
        },
        async set(values) {
          Object.assign(storage, clone(values));
        }
      }
    },
    downloads: {
      async download(options) {
        downloads.push(clone(options));
        return downloads.length;
      }
    },
    tabs: {
      async sendMessage(tabId, message) {
        broadcasts.push({ tabId, message: clone(message) });
        return {};
      }
    },
    runtime: {
      onMessage: {
        addListener(callback) { listener = callback; }
      }
    }
  };

  vm.runInNewContext(backgroundSource, { chrome, console, Date, encodeURIComponent, Promise, setTimeout });

  function send(message, sender = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`No response for ${message.type}`)), 1500);
      const keepChannelOpen = listener(message, sender, response => {
        clearTimeout(timeout);
        resolve(clone(response));
      });
      if (!keepChannelOpen) {
        clearTimeout(timeout);
        reject(new Error(`Message was not handled: ${message.type}`));
      }
    });
  }

  return { broadcasts, downloads, send, storage };
}

function recording(overrides = {}) {
  return {
    status: 'recording',
    title: 'Test yayını',
    startedAt: '2026-08-21T10:00:00.000Z',
    endedAt: null,
    updatedAt: '2026-08-21T10:05:00.000Z',
    finishReason: null,
    messageCount: 1,
    messages: [{ author: 'Ada', text: 'Merhaba', displayTime: '13:05', capturedAt: '2026-08-21T10:05:00.000Z' }],
    ...overrides
  };
}

test('a finished recording is auto-downloaded exactly once', async () => {
  const harness = createHarness({ settings: { autoDownloadOnFinish: true } });
  const finished = recording({ status: 'finished', endedAt: '2026-08-21T10:10:00.000Z' });

  await harness.send({ type: 'PERSIST_RECORDING', recording: finished }, { tab: { id: 12 }, frameId: 7 });
  await harness.send({ type: 'PERSIST_RECORDING', recording: finished }, { tab: { id: 12 }, frameId: 7 });

  assert.equal(harness.downloads.length, 2);
  assert.match(harness.downloads[0].filename, /\.json$/);
  assert.match(harness.downloads[1].filename, /\.txt$/);
  assert.ok(harness.storage.recordings['12'].autoDownloadedAt);
});

test('an end signal in another frame finishes and downloads the saved chat', async () => {
  const harness = createHarness({ settings: { autoDownloadOnFinish: true } });
  await harness.send({ type: 'PERSIST_RECORDING', recording: recording() }, { tab: { id: 42 }, frameId: 9 });

  const response = await harness.send({ type: 'LIVE_END_DETECTED' }, { tab: { id: 42 }, frameId: 0 });

  assert.equal(response.success, true);
  assert.deepEqual(harness.broadcasts, [{ tabId: 42, message: { type: 'LIVE_ENDED' } }]);
  assert.equal(harness.storage.recordings['42'].status, 'finished');
  assert.equal(harness.storage.recordings['42'].finishReason, 'Yayın sona erdi');
  assert.equal(harness.downloads.length, 2);
});

test('the setting disables automatic downloads without losing the recording', async () => {
  const harness = createHarness({ settings: { autoDownloadOnFinish: false } });
  await harness.send(
    { type: 'PERSIST_RECORDING', recording: recording({ status: 'finished' }) },
    { tab: { id: 5 }, frameId: 3 }
  );

  assert.equal(harness.downloads.length, 0);
  assert.equal(harness.storage.recordings['5'].status, 'finished');
  assert.equal(harness.storage.recordings['5'].autoDownloadedAt, undefined);
});
