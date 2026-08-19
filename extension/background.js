const RECORDINGS_KEY = 'recordings';

async function getRecordings() {
  const result = await chrome.storage.local.get(RECORDINGS_KEY);
  return result[RECORDINGS_KEY] || {};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_LATEST_RECORDING') {
    (async () => {
      const recordings = Object.values(await getRecordings())
        .filter(recording => Array.isArray(recording.messages) && recording.messages.length > 0)
        .sort((a, b) => new Date(b.updatedAt || b.endedAt || b.startedAt || 0) - new Date(a.updatedAt || a.endedAt || a.startedAt || 0));
      sendResponse(recordings[0] || null);
    })().catch(() => sendResponse(null));
    return true;
  }

  if (message.type === 'PERSIST_RECORDING' && sender.tab?.id != null) {
    (async () => {
      const recordings = await getRecordings();
      recordings[String(sender.tab.id)] = { ...message.recording, tabId: sender.tab.id };
      await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });
      sendResponse({ success: true });
    })().catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'DELETE_RECORDING') {
    (async () => {
      const recordings = await getRecordings();
      delete recordings[String(message.tabId)];
      await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });
      sendResponse({ success: true });
    })().catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
