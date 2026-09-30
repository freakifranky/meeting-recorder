const $ = id => document.getElementById(id);
let tab, tick;

const mmss = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
const cleanTitle = t => (t || 'This tab').replace(/\s*[-|]\s*(Google Meet|Zoom|Microsoft Teams|Webex|Whereby)\b.*$/i, '').replace(/^Meet\s*[-–]\s*/i, '').trim() || 'Meeting';
const PLATFORMS = [
  [/^https:\/\/meet\.google\.com\//, 'Google Meet'],
  [/^https:\/\/([\w-]+\.)?zoom\.(us|com)\/(wc|j)\//, 'Zoom (web)'],
  [/^https:\/\/app\.zoom\.us\//, 'Zoom (web)'],
  [/^https:\/\/teams\.(microsoft|live)\.com\//, 'Microsoft Teams'],
  [/^https:\/\/[\w-]+\.webex\.com\//, 'Webex'],
  [/^https:\/\/whereby\.com\//, 'Whereby'],
  [/^https:\/\/discord\.com\//, 'Discord']
];

$('recs').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: 'results.html' }); };
$('allow').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: 'permission.html' }); };

async function loadMics() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
  const granted = devs.some(d => d.label);
  $('micWarn').hidden = granted;
  const { micId = '' } = await chrome.storage.local.get('micId');
  const sel = $('mic');
  sel.replaceChildren();
  const add = (value, text) => sel.append(Object.assign(document.createElement('option'), { value, textContent: text }));
  add('', 'System default');
  if (granted) devs.filter(d => d.deviceId !== 'default' && d.deviceId !== 'communications').forEach(d => add(d.deviceId, d.label));
  add('none', "Don't record my mic");
  sel.value = [...sel.options].some(o => o.value === micId) ? micId : '';
  sel.onchange = () => chrome.storage.local.set({ micId: sel.value });
}

function showLive(rec) {
  $('idle').hidden = true; $('live').hidden = false; $('dot').classList.add('live');
  $('liveTitle').textContent = cleanTitle(rec.title);
  $('liveMic').textContent = rec.mic === 'off' ? 'Mic: not recorded' : 'Mic: ' + rec.mic;
  const upd = () => ($('clock').textContent = mmss(Date.now() - rec.startedAt));
  upd(); tick = setInterval(upd, 500);
}

async function showIdle() {
  $('live').hidden = true; $('idle').hidden = false; $('dot').classList.remove('live');
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('tabTitle').textContent = cleanTitle(tab.title);
  const hit = PLATFORMS.find(([re]) => re.test(tab.url || ''));
  const hint = $('tabHint');
  hint.textContent = hit ? hit[1] + ' detected' : 'Not a call tab. It will record whatever audio this tab plays.';
  hint.className = hit ? 'ok' : 'warn';
  $('title').value = cleanTitle(tab.title);
  await loadMics();
}

$('start').onclick = async () => {
  $('err').textContent = ''; $('start').disabled = true; $('start').textContent = 'Starting…';
  const r = await chrome.runtime.sendMessage({
    target: 'background', type: 'start',
    tabId: tab.id, title: $('title').value.trim() || cleanTitle(tab.title), micId: $('mic').value, vocab: $('vocab').value.trim()
  });
  $('start').disabled = false; $('start').textContent = 'Start recording';
  if (r && r.ok) showLive(r.rec);
  else $('err').textContent = (r && r.error) || 'Could not start.';
};

$('stop').onclick = async () => {
  $('stop').disabled = true; $('stop').textContent = 'Saving…';
  clearInterval(tick);
  await chrome.runtime.sendMessage({ target: 'background', type: 'stop' });
  setTimeout(() => window.close(), 400);
};

chrome.storage.session.get('rec').then(({ rec }) => (rec ? showLive(rec) : showIdle()));
