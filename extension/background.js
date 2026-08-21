const RECORDINGS_KEY = 'recordings';
const SETTINGS_KEY = 'settings';
let recordingMutationQueue = Promise.resolve();

async function getRecordings() {
  const result = await chrome.storage.local.get(RECORDINGS_KEY);
  return result[RECORDINGS_KEY] || {};
}

function mutateRecordings(task) {
  const operation = recordingMutationQueue.then(task, task);
  recordingMutationQueue = operation.catch(() => {});
  return operation;
}

function messageCount(recording) {
  return Array.isArray(recording?.messages) ? recording.messages.length : Number(recording?.messageCount) || 0;
}

function shouldReplaceRecording(existing, incoming, frameId) {
  if (!existing || existing.frameId === frameId) return true;
  const existingCount = messageCount(existing);
  const incomingCount = messageCount(incoming);
  if (incomingCount !== existingCount) return incomingCount > existingCount;
  if (incomingCount > 0) {
    return new Date(incoming.updatedAt || 0) >= new Date(existing.updatedAt || 0);
  }
  return incoming.status === 'recording' && existing.status !== 'recording';
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

async function maybeAutoDownload(recording) {
  if (recording?.status !== 'finished' || !recording.messages?.length || recording.autoDownloadedAt) {
    return recording;
  }
  const { [SETTINGS_KEY]: settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  if (!settings.autoDownloadOnFinish) return recording;
  await downloadFinishedRecording(recording);
  return { ...recording, autoDownloadedAt: new Date().toISOString() };
}

async function persistRecording(tabId, frameId, incoming) {
  return mutateRecordings(async () => {
    const recordings = await getRecordings();
    const key = String(tabId);
    const existing = recordings[key];
    if (!shouldReplaceRecording(existing, incoming, frameId)) return existing;

    let recording = { ...incoming, tabId, frameId };
    if (existing?.startedAt && existing.startedAt === recording.startedAt && existing.autoDownloadedAt) {
      recording.autoDownloadedAt = existing.autoDownloadedAt;
    }

    // Store first so the recording remains recoverable even if Chrome rejects a download.
    recordings[key] = recording;
    await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });

    const completed = await maybeAutoDownload(recording);
    if (completed !== recording) {
      recordings[key] = completed;
      await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });
      recording = completed;
    }
    return recording;
  });
}

async function finishSavedRecording(tabId) {
  return mutateRecordings(async () => {
    const recordings = await getRecordings();
    const key = String(tabId);
    const existing = recordings[key];
    if (!existing?.messages?.length) return existing || null;

    const pageWasUnloaded = existing.status === 'stopped' && existing.finishReason === 'Sayfa kapatıldı veya değiştirildi';
    if (existing.status !== 'recording' && existing.status !== 'finished' && !pageWasUnloaded) return existing;

    let recording = existing.status === 'finished' ? existing : {
      ...existing,
      status: 'finished',
      endedAt: existing.endedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishReason: 'Yayın sona erdi'
    };
    recordings[key] = recording;
    await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });

    const completed = await maybeAutoDownload(recording);
    if (completed !== recording) {
      recordings[key] = completed;
      await chrome.storage.local.set({ [RECORDINGS_KEY]: recordings });
      recording = completed;
    }
    return recording;
  });
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

  if (message.type === 'GET_TAB_RECORDING') {
    getRecordings()
      .then(recordings => sendResponse(recordings[String(message.tabId)] || null))
      .catch(() => sendResponse(null));
    return true;
  }

  if (message.type === 'LIVE_END_DETECTED' && sender.tab?.id != null) {
    (async () => {
      const tabId = sender.tab.id;
      // The end signal can originate in the player frame while the messages
      // live in a sibling chat frame. Broadcast it to every content script.
      await chrome.tabs.sendMessage(tabId, { type: 'LIVE_ENDED' }).catch(() => {});
      // A removed/navigated chat frame cannot receive the broadcast. Give an
      // active frame time to persist its freshest state, then finish the saved copy.
      await new Promise(resolve => setTimeout(resolve, 500));
      const recording = await finishSavedRecording(tabId);
      sendResponse({ success: true, recording });
    })().catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'PERSIST_RECORDING' && sender.tab?.id != null) {
    persistRecording(sender.tab.id, sender.frameId ?? 0, message.recording)
      .then(recording => sendResponse({ success: true, recording }))
      .catch(error => sendResponse({ success: false, error: error.message }));
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
