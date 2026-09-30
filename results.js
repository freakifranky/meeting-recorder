const PROVIDERS = {
  groq: { base: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
  openai: { base: 'https://api.openai.com/v1', model: 'whisper-1' }
};
const MAX = 24.5 * 1024 * 1024;
const FILLERS = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'i mean', 'kind of', 'sort of', 'coming from', 'right', 'so yeah'];
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const mmss = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); };
const mins = s => (s / 60).toFixed(1) + ' min';
const slug = r => (r.title || 'meeting').replace(/[^\w-]+/g, '-').slice(0, 40) + '_' + new Date(r.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const words = t => (t.match(/[\p{L}\p{N}']+/gu) || []).length;

async function loadSettings() {
  const { cfg = { provider: 'groq', key: '', lang: 'en', vocab: '' } } = await chrome.storage.local.get('cfg');
  $('provider').value = cfg.provider; $('key').value = cfg.key; $('lang').value = cfg.lang; $('vocab').value = cfg.vocab || '';
  if (!cfg.key) $('settings').open = true;
}
$('save').onclick = async () => {
  await chrome.storage.local.set({ cfg: { provider: $('provider').value, key: $('key').value.trim(), lang: $('lang').value, vocab: $('vocab').value.trim() } });
  $('saved').textContent = 'Saved.';
};

// Whisper's prompt is capped around 224 tokens; keep the vocab well under that.
function buildPrompt(cfg, extra) {
  const terms = [cfg.vocab, extra].filter(Boolean).join(', ').split(',').map(s => s.trim()).filter(Boolean);
  const uniq = [...new Set(terms)].join(', ').slice(0, 600);
  return 'A recorded meeting conversation.' + (uniq ? ' Names and terms: ' + uniq + '.' : '');
}

// Quality gate. High compression ratio = repetition loop; very low logprob = guessing.
function clean(segs) {
  const out = [];
  const recent = [];
  for (const s of segs) {
    const text = (s.text || '').trim();
    if (!text || (s.no_speech_prob ?? 0) > 0.6) continue;
    const bad = (s.compression_ratio ?? 0) > 2.4 || (s.avg_logprob ?? 0) < -1.0;
    const key = norm(text);
    const repeat = words(text) >= 4 && recent.includes(key);
    if (bad || repeat) {
      if (key) { recent.push(key); if (recent.length > 5) recent.shift(); }
      const last = out[out.length - 1];
      if (last && last.inaudible) last.end = s.end;
      else out.push({ start: s.start, end: s.end, text: '[inaudible]', inaudible: true });
      continue;
    }
    recent.push(key); if (recent.length > 5) recent.shift();
    out.push({ start: s.start, end: s.end, text });
  }
  return out;
}

async function whisper(blob, cfg, extra) {
  if (!blob || blob.size < 2000) return [];
  if (blob.size > MAX) throw new Error('Track is over 25 MB (roughly 2+ hours). Trim it or transcribe offline.');
  const p = PROVIDERS[cfg.provider];
  const fd = new FormData();
  fd.append('file', blob, 'audio.webm');
  fd.append('model', p.model);
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  fd.append('prompt', buildPrompt(cfg, extra));
  if (cfg.lang) fd.append('language', cfg.lang);
  const r = await fetch(p.base + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.key }, body: fd });
  if (!r.ok) throw new Error(cfg.provider + ' returned ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return clean(j.segments || []);
}

function merge(me, them) {
  const all = [...me.map(s => ({ ...s, who: 'You' })), ...them.map(s => ({ ...s, who: 'Others' }))].sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && last.who === s.who && s.start - last.end < 4) {
      last.text = last.inaudible && s.inaudible ? last.text : last.text + ' ' + s.text;
      last.inaudible = !!(last.inaudible && s.inaudible);
      last.end = Math.max(last.end, s.end);
    } else out.push({ who: s.who, start: s.start, end: s.end, text: s.text, inaudible: !!s.inaudible });
  }
  return out;
}

function stats(lines) {
  const per = {};
  for (const who of ['You', 'Others']) {
    const ls = lines.filter(l => l.who === who);
    const talk = ls.reduce((a, l) => a + (l.end - l.start), 0);
    const longest = ls.reduce((a, l) => (l.end - l.start > (a ? a.end - a.start : 0) ? l : a), null);
    per[who] = { words: ls.reduce((a, l) => a + (l.inaudible ? 0 : words(l.text)), 0), talk, turns: ls.length, longest };
  }
  const total = per.You.talk + per.Others.talk || 1;
  const mine = ' ' + norm(lines.filter(l => l.who === 'You' && !l.inaudible).map(l => l.text).join(' ')) + ' ';
  const fillers = FILLERS.map(f => [f, mine.split(' ' + f + ' ').length - 1]).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  const questions = [];
  lines.filter(l => l.who === 'Others' && !l.inaudible).forEach(l =>
    (l.text.replace(/\[inaudible\]/g, '').match(/[^.?!]*\?/g) || []).map(q => q.trim()).filter(q => words(q) >= 4).forEach(q => questions.push({ at: l.start, q })));
  const inaudible = lines.filter(l => l.inaudible).reduce((a, l) => a + (l.end - l.start), 0);
  return { per, share: Math.round((per.You.talk / total) * 100), fillers, questions, inaudible };
}

function statsText(st) {
  const p = st.per, lo = p.You.longest;
  return [
    `Talk share: you ${st.share}%, others ${100 - st.share}%`,
    `You: ${p.You.words} words, ${mins(p.You.talk)}, ${p.You.turns} turns`,
    `Others: ${p.Others.words} words, ${mins(p.Others.talk)}, ${p.Others.turns} turns`,
    lo ? `Your longest stretch: ${mins(lo.end - lo.start)} starting ${mmss(lo.start)}` : '',
    st.fillers.length ? 'Filler phrases: ' + st.fillers.map(([f, n]) => `"${f}" ${n}x`).join(', ') : '',
    st.inaudible > 5 ? `Marked inaudible: ${mins(st.inaudible)}. Listen to those stretches in the audio.` : '',
    '', 'Questions from others:',
    ...st.questions.map(q => `[${mmss(q.at)}] ${q.q}`)
  ].filter(x => x !== '').join('\n');
}

const asText = (r, lines) => `${r.title}\n${new Date(r.startedAt).toLocaleString()} | ${mmss(r.duration / 1000)}\n\n` +
  '== STATS ==\n' + statsText(stats(lines)) + '\n\n== TRANSCRIPT ==\n\n' +
  lines.map(l => `[${mmss(l.start)}] ${l.who}: ${l.text}`).join('\n\n');

function renderStats(st) {
  const p = st.per, lo = p.You.longest;
  const row = (who) => el('tr', {}, el('td', { textContent: who }), el('td', { textContent: p[who].words }), el('td', { textContent: mins(p[who].talk) }), el('td', { textContent: p[who].turns }));
  const box = el('div', { className: 'stats' },
    el('b', { textContent: `Talk share: you ${st.share}%` }),
    el('table', {}, el('tr', {}, ...['', 'Words', 'Talk time', 'Turns'].map(t => el('th', { textContent: t }))), row('You'), row('Others')));
  if (lo) box.append(el('div', { textContent: `Your longest stretch: ${mins(lo.end - lo.start)} at ${mmss(lo.start)}` }));
  if (st.fillers.length) box.append(el('div', { textContent: 'Fillers: ' + st.fillers.map(([f, n]) => `"${f}" ${n}x`).join(', ') }));
  if (st.inaudible > 5) box.append(el('div', { className: 'inaudible', textContent: `${mins(st.inaudible)} marked inaudible. Check those in the audio.` }));
  if (st.questions.length) {
    const d = el('details', { style: 'margin-top:8px;padding:8px 12px' }, el('summary', { textContent: `Questions from others (${st.questions.length})` }));
    st.questions.forEach(q => d.append(el('p', { className: 'line' }, el('span', { className: 't', textContent: mmss(q.at) }), q.q)));
    box.append(d);
  }
  return box;
}

function renderTranscript(box, r) {
  box.replaceChildren();
  if (!r.transcript) return;
  r.transcript.forEach(l => { if (l.who === 'Interviewer') l.who = 'Others'; });
  const wrap = el('div', { className: 'transcript' });
  r.transcript.forEach(l => wrap.append(el('p', { className: 'line who-' + l.who + (l.inaudible ? ' inaudible' : '') },
    el('span', { className: 't', textContent: mmss(l.start) }), el('b', { textContent: l.who + ': ' }), l.text)));
  const txt = asText(r, r.transcript);
  const copy = el('button', { textContent: 'Copy transcript + stats', onclick: async () => { await navigator.clipboard.writeText(txt); copy.textContent = 'Copied'; } });
  const dl = el('a', { className: 'btn', textContent: 'Download .txt', download: slug(r) + '.txt', href: URL.createObjectURL(new Blob([txt], { type: 'text/plain' })) });
  box.append(renderStats(stats(r.transcript)), el('div', { className: 'row' }, copy, dl), wrap);
}

function card(r, focus) {
  const box = el('div');
  const status = el('span', { className: 'muted' });
  const links = [['full', 'Full audio'], ['me', 'You only'], ['them', 'Others only']]
    .filter(([k]) => r[k])
    .map(([k, label]) => el('a', { className: 'btn', textContent: `${label} (${(r[k].size / 1048576).toFixed(1)} MB)`, download: `${slug(r)}_${k}.webm`, href: URL.createObjectURL(r[k]) }));

  const vocab = el('input', { value: r.vocab || '', placeholder: 'People, companies, products, jargon' });
  const tBtn = el('button', { className: 'primary', textContent: r.transcript ? 'Transcribe again' : 'Transcribe' });
  tBtn.onclick = async () => {
    const { cfg } = await chrome.storage.local.get('cfg');
    if (!cfg || !cfg.key) { $('settings').open = true; $('key').focus(); status.textContent = 'Add an API key first.'; return; }
    tBtn.disabled = true; status.textContent = 'Transcribing both tracks…';
    try {
      r.vocab = vocab.value.trim();
      const [me, them] = await Promise.all([whisper(r.me, cfg, r.vocab), whisper(r.them, cfg, r.vocab)]);
      r.transcript = merge(me, them);
      await dbPut(r);
      status.textContent = r.transcript.length ? '' : 'No speech found. Check the level of both tracks.';
      tBtn.textContent = 'Transcribe again';
      renderTranscript(box, r);
    } catch (e) { status.textContent = e.message; }
    tBtn.disabled = false;
  };

  const del = el('button', { className: 'danger', textContent: 'Delete', onclick: async () => {
    if (confirm('Delete this recording and transcript from Brave?')) { await dbDel(r.id); render(); }
  } });

  const c = el('div', { className: 'card' + (focus ? ' focus' : '') },
    el('h2', { textContent: r.title }),
    el('div', { className: 'muted', textContent: `${new Date(r.startedAt).toLocaleString()} | ${mmss(r.duration / 1000)}` }),
    el('div', { className: 'row' }, ...links),
    el('label', {}, 'Names and terms to spell right', vocab),
    el('div', { className: 'row' }, tBtn, del, status),
    box);
  renderTranscript(box, r);
  return c;
}

async function render() {
  const focus = location.hash.slice(1);
  const recs = (await dbAll()).sort((a, b) => b.startedAt - a.startedAt);
  $('list').replaceChildren(...(recs.length ? recs.map(r => card(r, r.id === focus))
    : [el('p', { className: 'muted', textContent: 'No recordings yet. Open your Meet tab, click the extension icon, and press Start recording.' })]));
  const f = document.querySelector('.card.focus'); f && f.scrollIntoView({ block: 'center' });
}

const err = new URLSearchParams(location.search).get('err');
if (err) $('err').append(el('div', { className: 'banner', textContent: err }));
loadSettings().then(render);
