const $ = id => document.getElementById(id);
let current = null;

function statusText(status) {
  return ({ waiting: 'Vimeo yayını bekleniyor', recording: 'Kayıt sürüyor', finished: 'Yayın bitti · kayıt hazır', stopped: 'Kayıt durdu · dışa aktarmaya hazır' })[status] || 'Hazır';
}

async function activeVimeoTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  try {
    const hostname = new URL(tab.url).hostname;
    return hostname === 'vimeo.com' || hostname.endsWith('.vimeo.com') ? tab : null;
  } catch (_) { return null; }
}

function countOf(recording) {
  return Array.isArray(recording?.messages) ? recording.messages.length : Number(recording?.messageCount) || 0;
}

function update(recording) {
  current = recording;
  $('status').textContent = statusText(recording?.status);
  $('count').textContent = recording?.messageCount || 0;
  const ready = Boolean(recording?.canExport || recording?.messages?.length);
  $('downloadJson').disabled = !ready;
  $('downloadTxt').disabled = !ready;
  $('toggle').textContent = recording?.status === 'recording' || recording?.status === 'waiting' ? 'Kaydı durdur' : 'Yeni kayıt başlat';
  $('toggle').disabled = !recording?.isLive;
  $('detail').textContent = recording?.source === 'saved'
    ? 'Son kayıt bu cihazda saklanıyor ve indirilmeye hazır.'
    : recording?.startedAt
    ? `Başlangıç: ${new Date(recording.startedAt).toLocaleString('tr-TR')}`
    : 'Sohbet görünür olduğunda kayıt otomatik başlar.';
}

async function refresh() {
  try {
    const tab = await activeVimeoTab();
    if (!tab) {
      const saved = await chrome.runtime.sendMessage({ type: 'GET_LATEST_RECORDING' });
      update(saved ? { ...saved, source: 'saved', isLive: false } : null);
      if (!saved) $('status').textContent = 'Bir Vimeo sayfası açın';
      return;
    }
    const [direct, saved] = await Promise.all([
      chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }).catch(() => null),
      chrome.runtime.sendMessage({ type: 'GET_TAB_RECORDING', tabId: tab.id }).catch(() => null)
    ]);
    const data = countOf(saved) > countOf(direct) ? saved : direct || saved;
    update(data ? { ...data, isLive: true } : null);
  } catch (_) { update(null); $('status').textContent = 'Sayfa hazırlanıyor…'; }
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  $('autoDownload').checked = Boolean(settings.autoDownloadOnFinish);
}

function fileStem() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `vimeo-sohbet-kaydi-${stamp}`;
}

function download(format) {
  if (!current?.messages?.length) return;
  const output = format === 'json'
    ? JSON.stringify({ format: 'Vimeo sohbet kaydı', exportedAt: new Date().toISOString(), ...current }, null, 2)
    : [
        `Vimeo sohbet kaydı`, `Başlangıç: ${current.startedAt || '-'}`, `Bitiş: ${current.endedAt || '-'}`,
        `Yayın: ${current.title || '-'}`, '',
        ...current.messages.map(m => `[${m.displayTime || new Date(m.capturedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}] ${m.author}: ${m.text}`)
      ].join('\n');
  const blob = new Blob([output], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${fileStem()}.${format}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('toggle').addEventListener('click', async () => {
  const tab = await activeVimeoTab(); if (!tab || !current?.isLive) return;
  const type = current.status === 'recording' || current.status === 'waiting' ? 'STOP_RECORDING' : 'START_RECORDING';
  const result = await chrome.tabs.sendMessage(tab.id, { type }).catch(() => null);
  if (result) update({ ...result, isLive: true });
});
$('downloadJson').addEventListener('click', () => download('json'));
$('downloadTxt').addEventListener('click', () => download('txt'));
$('autoDownload').addEventListener('change', async event => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...settings, autoDownloadOnFinish: event.target.checked } });
});
document.addEventListener('DOMContentLoaded', () => { loadSettings(); refresh(); setInterval(refresh, 1500); });
