const $ = id => document.getElementById(id);
let current = null;

function statusText(status) {
  return ({ waiting: 'Vimeo yayını bekleniyor', recording: 'Kayıt sürüyor', finished: 'Yayın bitti · kayıt hazır', stopped: 'Kayıt durdu · dışa aktarmaya hazır' })[status] || 'Hazır';
}

async function activeVimeoTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id && tab.url?.includes('vimeo.com') ? tab : null;
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
    const data = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
    update({ ...data, isLive: true });
  } catch (_) { update(null); $('status').textContent = 'Sayfa hazırlanıyor…'; }
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
  update(await chrome.tabs.sendMessage(tab.id, { type }));
});
$('downloadJson').addEventListener('click', () => download('json'));
$('downloadTxt').addEventListener('click', () => download('txt'));
document.addEventListener('DOMContentLoaded', () => { refresh(); setInterval(refresh, 1500); });
