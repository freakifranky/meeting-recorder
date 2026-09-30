chrome.runtime.onInstalled.addListener(d => {
  if (d.reason === 'install') chrome.tabs.create({ url: 'permission.html' });
});

async function offscreenExists() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return ctxs.length > 0;
}

function idle() {
  chrome.storage.session.remove('rec');
  chrome.action.setBadgeText({ text: '' });
}

async function start({ tabId, title, micId, vocab }) {
  if (await offscreenExists()) {
    const { rec } = await chrome.storage.session.get('rec');
    if (rec) return { ok: false, error: 'Already recording.' };
    await chrome.offscreen.closeDocument().catch(() => {});
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record meeting audio from the tab and microphone'
  });

  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (e) {
    await chrome.offscreen.closeDocument().catch(() => {});
    return { ok: false, error: 'Could not capture this tab: ' + e.message };
  }

  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, title, micId, vocab });
  if (!r || !r.ok) {
    await chrome.offscreen.closeDocument().catch(() => {});
    return { ok: false, error: r ? r.error : 'Recorder did not respond' };
  }
  const rec = { tabId, title, startedAt: Date.now(), mic: r.mic };
  await chrome.storage.session.set({ rec });
  chrome.action.setBadgeBackgroundColor({ color: '#c2362b' });
  chrome.action.setBadgeText({ text: 'REC' });
  return { ok: true, rec };
}

async function stop() {
  if (!(await offscreenExists())) { idle(); return { ok: false, error: 'Recorder was not running.' }; }
  chrome.action.setBadgeText({ text: '...' });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.target !== 'background') return;
  if (msg.type === 'start') { start(msg).then(send, e => send({ ok: false, error: e.message })); return true; }
  if (msg.type === 'stop') { stop().then(send); return true; }
  if (msg.type === 'saved') {
    idle();
    chrome.tabs.create({ url: 'results.html#' + msg.id });
    chrome.offscreen.closeDocument().catch(() => {});
  }
  if (msg.type === 'error') {
    idle();
    chrome.tabs.create({ url: 'results.html?err=' + encodeURIComponent(msg.error || 'Unknown error') });
  }
});
