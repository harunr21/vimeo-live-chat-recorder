const RECORDINGS_KEY = 'recordings';
const SETTINGS_KEY = 'settings';

async function getRecordings() {
  const result = await chrome.storage.local.get(RECORDINGS_KEY);
  return result[RECORDINGS_KEY] || {};
}

function downloadName(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `vimeo-chat-recording-${stamp}.${extension}`;
}

function textExport(recording) {
  return [
    'Vimeo sohbet kaydı',
    `Başlangıç: ${recording.startedAt || '-'}`,
    `Bitiş: ${recording.endedAt || '-'}`,
    `Yayın: ${recording.title || '-'}`,
    '',
    ...(recording.messages || []).map(message => {
      const time = message.displayTime || new Date(message.capturedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      return `[${time}] ${message.author}: ${message.text}`;
    })
  ].join('\n');
}

async function downloadFinishedRecording(recording) {
  if (!recording?.messages?.length) return;
  const json = JSON.stringify({ format: 'Vimeo sohbet kaydı', exportedAt: new Date().toISOString(), ...recording }, null, 2);
  const txt = textExport(recording);
  await Promise.all([
    chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
      filename: downloadName('json'),
      saveAs: false,
      conflictAction: 'uniquify'
    }),
    chrome.downloads.download({
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(txt)}`,
      filename: downloadName('txt'),
      saveAs: false,
      conflictAction: 'uniquify'
    })
  ]);
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

  if (message.type === 'AUTO_DOWNLOAD_RECORDING') {
    downloadFinishedRecording(message.recording)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
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
