let recs = [], streams = [], ctx, startedAt, title, vocab = '', stopping = false;

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') {
    start(msg).then(mic => send({ ok: true, mic }), e => send({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'stop') stop();
});

function makeRecorder(name, stream, bps) {
  const chunks = [];
  const r = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: bps });
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => (r.onstop = () => res([name, new Blob(chunks, { type: 'audio/webm' })])));
  r.start(10000);
  return { r, done };
}

async function start({ streamId, title: t, micId, vocab: v }) {
  title = t || 'Meeting';
  vocab = v || '';
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });

  let mic = null, micLabel = 'off';
  if (micId !== 'none') {
    const base = { echoCancellation: true, noiseSuppression: true };
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: micId ? { ...base, deviceId: { exact: micId } } : base });
    } catch (e) {
      if (e.name === 'OverconstrainedError' || e.name === 'NotFoundError') {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: base }); } catch (e2) { tab.getTracks().forEach(tr => tr.stop()); throw new Error('Microphone blocked. Open the popup and click Allow microphone.'); }
      } else { tab.getTracks().forEach(tr => tr.stop()); throw new Error('Microphone blocked. Open the popup and click Allow microphone.'); }
    }
    micLabel = mic.getAudioTracks()[0].label || 'default mic';
  }
  streams = [tab, mic].filter(Boolean);

  ctx = new AudioContext();
  const tabSrc = ctx.createMediaStreamSource(tab);
  tabSrc.connect(ctx.destination); // keep hearing the call
  const mix = ctx.createMediaStreamDestination();
  tabSrc.connect(mix);
  if (mic) ctx.createMediaStreamSource(mic).connect(mix);

  recs = [makeRecorder('full', mix.stream, 48000), makeRecorder('them', tab, 24000)];
  if (mic) recs.push(makeRecorder('me', mic, 24000));
  startedAt = Date.now();
  tab.getAudioTracks()[0].onended = () => stop(); // tab closed
  return micLabel;
}

async function stop() {
  if (stopping || !recs.length) return;
  stopping = true;
  try {
    recs.forEach(x => x.r.state !== 'inactive' && x.r.stop());
    const parts = Object.fromEntries(await Promise.all(recs.map(x => x.done)));
    streams.forEach(s => s.getTracks().forEach(tr => tr.stop()));
    ctx && ctx.close();
    const id = String(startedAt);
    await dbPut({ id, title, vocab, startedAt, duration: Date.now() - startedAt, ...parts });
    chrome.runtime.sendMessage({ target: 'background', type: 'saved', id });
  } catch (e) {
    chrome.runtime.sendMessage({ target: 'background', type: 'error', error: 'Saving failed: ' + e.message });
  } finally {
    recs = []; stopping = false;
  }
}
