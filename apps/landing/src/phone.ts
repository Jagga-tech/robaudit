// Judge's phone page: docs/frontend-guide.md §8 (screens, audio contract), docs/demo-flow.md steps 1, 2, 4, 6.
import { DbConnection } from '@keel/bindings';
import { ConvexClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? 'https://hushed-shrimp-24.convex.cloud';
const STDB_URI = import.meta.env.VITE_STDB_URI ?? 'wss://maincloud.spacetimedb.com';
const STDB_DB = import.meta.env.VITE_STDB_DB ?? 'keel';
const ROLE = 'deployment_manager';
const MIC_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

type Me = { id: Id<'managers'>; name: string };
type Row = Doc<'clarifications'>;
type Sent = { text: string; at: number };
// The call, kept locally so live updates don't wipe a recording or an edit in progress.
type Call = { id: Id<'clarifications'>; phase: 'ask' | 'recording' | 'transcribing' | 'review' | 'edit'; transcript: string; micFailed: boolean; played: boolean };

/** Float32 mono samples at `inRate` -> 16 kHz mono PCM16 WAV with a 44-byte header (Convex cannot transcode webm/opus). */
export function encodeWav(input: Float32Array, inRate: number): Blob {
  const ratio = inRate / 16000, n = Math.floor(input.length / ratio);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); // PCM, mono
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { // box-filter downsample
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += input[j] ?? 0;
    s = Math.max(-1, Math.min(1, s / (b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([v.buffer], { type: 'audio/wav' });
}

/** Start the mic; resolves to a stop() that returns the WAV. AudioContext is created before the await so iOS counts the tap. */
async function startRecording(): Promise<() => Promise<Blob>> {
  const ac = new AudioContext();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }).catch((e) => { ac.close(); throw e; });
  await ac.resume();
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1); // ponytail: deprecated but universal; AudioWorklet if it glitches
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(ac.destination);
  return async () => {
    proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop());
    const rate = ac.sampleRate; await ac.close();
    const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    return encodeWav(all, rate);
  };
}

const SR = typeof window === 'undefined' ? undefined : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);
/** Browser dictation; `onText` gets the running transcript. Returns stop(). */
function dictate(onText: (t: string) => void, onEnd: () => void): () => void {
  const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
  rec.onresult = (e: any) => onText([...e.results].map((r: any) => r[0].transcript).join(''));
  rec.onerror = rec.onend = onEnd;
  rec.start();
  return () => rec.stop();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const label = (o: string) => o.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()); // "new_total" -> "New total"
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

if (typeof document !== 'undefined') boot();

function boot() {
  const app = document.getElementById('app')!;
  const connLine = document.getElementById('conn')!;
  const convex = new ConvexClient(CONVEX_URL);
  const load = <T>(k: string, d: T): T => { try { return JSON.parse(sessionStorage.getItem(k) ?? '') as T; } catch { return d; } };

  let me = load<Me | null>('keel-manager', null);
  let sent = load<Sent[]>('keel-sent', []);
  let ledger: DbConnection | undefined;
  let ledgerState = 'offline';
  let active: Row | null = null;
  let call: Call | undefined;
  let doneUntil = 0;
  let homeNote = '';
  let stopTranscript: (() => void) | undefined;

  const $ = <T extends HTMLElement>(sel: string) => app.querySelector(sel) as T;
  const showErr = (msg: string) => { const e = $('.err'); if (e) e.textContent = msg; };
  const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^.*?Uncaught Error:\s*/s, '').split('\n')[0];

  function paintConn() {
    const c = convex.connectionState();
    connLine.textContent = `ledger: ${ledgerState} · convex: ${c.isWebSocketConnected ? 'online' : 'connecting'}`;
  }
  convex.subscribeToConnectionState(paintConn);

  // ---- SpacetimeDB (docs/frontend-guide.md §4): one identity per role, kept in localStorage ----
  async function connectLedger(name: string) {
    ledger?.disconnect();
    ledgerState = 'connecting'; paintConn();
    const key = `keel-token-${ROLE}`;
    const c = await new Promise<DbConnection>((resolve, reject) => {
      DbConnection.builder()
        .withUri(STDB_URI).withDatabaseName(STDB_DB)
        .withToken(localStorage.getItem(key) ?? undefined)
        .onConnect((c, _id, token) => { localStorage.setItem(key, token); resolve(c); })
        .onConnectError((_ctx, e) => reject(e))
        .onDisconnect(() => { if (ledger === c) { ledgerState = 'offline'; paintConn(); } })
        .build();
    });
    await new Promise<void>((resolve, reject) => {
      c.subscriptionBuilder().onApplied(() => resolve()).onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
        .subscribe(['SELECT * FROM user', 'SELECT * FROM project', 'SELECT * FROM source']);
    });
    const u = c.db.user.identity.find(c.identity!);
    if (!u || u.role !== ROLE || u.name !== name) await c.reducers.registerDemoUser({ name, role: ROLE });
    ledger = c; ledgerState = 'online'; paintConn();
  }
  const ensureLedger = () => { if (me && ledgerState !== 'online' && ledgerState !== 'connecting') connectLedger(me.name).catch(() => { ledgerState = 'offline'; paintConn(); }); };

  /** addSource as the deployment manager. Project looked up at send time: ids change after reset (docs/demo-flow.md, reset). */
  async function addSource(kind: string, text: string) {
    if (!ledger || ledgerState !== 'online') { ensureLedger(); throw new Error('Not connected to the ledger yet. Try again in a moment.'); }
    const projects = [...ledger.db.project.iter()];
    const p = projects.find((x) => x.name === 'Oakland deployment') ?? projects[0];
    if (!p) throw new Error('No project on the ledger yet.');
    const version = [...ledger.db.source.iter()].filter((s) => s.projectId === p.id).length + 1;
    await ledger.reducers.addSource({ projectId: p.id, kind, text, parentSourceId: 0n, version });
  }

  async function upload(blob: Blob): Promise<Id<'_storage'>> {
    const url = await convex.mutation(api.clarifications.generateUploadUrl, {});
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
    return (await res.json()).storageId;
  }

  // ---- screens ----
  function render() {
    document.body.classList.toggle('ring', !!active);
    if (!me) return renderJoin();
    if (active && call?.id === active._id) return renderCall(active, call);
    if (Date.now() < doneUntil) return renderDone();
    renderHome();
  }

  function renderJoin() {
    app.innerHTML = `
      <p class="eyebrow">RoboAudit · Oakland</p>
      <h1>You are the deployment manager for the Oakland deployment.</h1>
      <form class="stack" id="join">
        <label for="name">Your first name</label>
        <input id="name" type="text" autocomplete="given-name" autocapitalize="words" maxlength="40" required>
        <p class="err" role="alert"></p>
        <button class="pill dark" type="submit">Join</button>
      </form>`;
    $<HTMLFormElement>('#join').onsubmit = async (ev) => {
      ev.preventDefault();
      const name = $<HTMLInputElement>('#name').value.trim();
      if (!name) return showErr('Type your first name.');
      const btn = $<HTMLButtonElement>('button'); btn.disabled = true; btn.textContent = 'Joining…';
      try {
        const id = await convex.mutation(api.managers.join, { name });
        me = { id, name }; sessionStorage.setItem('keel-manager', JSON.stringify(me));
        render();
        await connectLedger(name);
      } catch (e) {
        ledgerState = 'offline'; paintConn();
        if (!me) { btn.disabled = false; btn.textContent = 'Join'; showErr(`Couldn't join: ${plain(e)}`); }
        else { homeNote = `Joined, but the ledger is unreachable (${plain(e)}). Retrying when you send.`; render(); }
      }
    };
  }

  function renderHome() {
    app.innerHTML = `
      <h1>Hi ${esc(me!.name)}. Send Summo a site update.</h1>
      <div class="field">
        <textarea id="text" aria-label="Site update" placeholder="e.g. conveyor rework is going to run another 80 grand"></textarea>
        <button class="mic" id="mic" type="button" aria-label="Speak the update" ${SR ? '' : 'hidden'}>${MIC_SVG}</button>
      </div>
      <p class="note">${esc(homeNote)}</p>
      <p class="err" role="alert"></p>
      <button class="pill dark" id="send" type="button">Send update</button>
      <label class="pill outline" id="photo">Photograph the forecast sheet<input type="file" accept="image/*" capture="environment"></label>
      ${sent.length ? `<h2>Your updates</h2><ul class="log">${sent.slice().reverse().map((s) => `<li><span>${esc(s.text)}</span><time>${hhmm(s.at)}</time></li>`).join('')}</ul>` : ''}`;
    const ta = $<HTMLTextAreaElement>('#text');
    const note = (s: string) => { homeNote = s; $('.note').textContent = s; };
    const log = (text: string) => { sent.push({ text, at: Date.now() }); sessionStorage.setItem('keel-sent', JSON.stringify(sent)); };
    const after = (msg: string) => { note(msg); setTimeout(() => { if (homeNote === msg) { homeNote = ''; if (!active) render(); } }, 6000); };

    let stopMic: (() => void) | undefined;
    const mic = $<HTMLButtonElement>('#mic');
    mic.onclick = () => {
      if (stopMic) return stopMic();
      mic.classList.add('on');
      stopMic = dictate((t) => { ta.value = t; }, () => { stopMic = undefined; mic.classList.remove('on'); });
    };

    $<HTMLButtonElement>('#send').onclick = async (ev) => {
      const text = ta.value.trim();
      if (!text) return showErr('Type or say an update first.');
      stopMic?.();
      const btn = ev.currentTarget as HTMLButtonElement; btn.disabled = true;
      try { await addSource('note', text); log(text); after('Sent. Summo is reading…'); render(); }
      catch (e) { btn.disabled = false; showErr(`Not sent: ${plain(e)}`); }
    };

    $<HTMLInputElement>('#photo input').onchange = async (ev) => {
      const input = ev.target as HTMLInputElement, file = input.files?.[0];
      if (!file) return;
      note('Uploading the sheet…');
      try { await addSource('scanned_forecast', await upload(file)); log('Forecast sheet photo'); after('Sheet sent. Reading…'); render(); }
      catch (e) { note(''); showErr(`Sheet not sent: ${plain(e)}`); }
      input.value = '';
    };
  }

  function renderDone() {
    app.innerHTML = `
      <h1>Thanks ${esc(me!.name)}. Summo booked it with your name on it.</h1>
      <button class="pill willow" id="back" type="button">Back to updates</button>`;
    $<HTMLButtonElement>('#back').onclick = () => { doneUntil = 0; render(); };
  }

  function renderCall(row: Row, c: Call) {
    const reask = row.status === 'fallback_text' || c.micFailed;
    let body: string;
    if (reask) {
      body = `
        <p class="lede">${c.micFailed ? 'The mic isn\'t available. Tap the answer.' : 'Summo didn\'t catch that. Tap the answer.'}</p>
        ${row.options.map((o, i) => `<button class="pill ${i ? 'outline' : 'dark'}" data-opt="${esc(o)}" type="button">${esc(label(o))}</button>`).join('')}
        ${c.micFailed && SR ? '<button class="pill quiet" id="dictate" type="button">Say it instead</button>' : ''}`;
    } else if (c.phase === 'transcribing') {
      body = `<p class="lede">Transcribing…</p>`;
    } else if (c.phase === 'review') {
      body = `
        <div class="card transcript">${esc(c.transcript)}</div>
        <button class="pill dark" id="yes" type="button">That's right</button>
        <button class="pill outline" id="edit" type="button">Edit</button>`;
    } else if (c.phase === 'edit') {
      body = `
        <textarea id="fix" aria-label="Your answer">${esc(c.transcript)}</textarea>
        <button class="pill dark" id="yes" type="button">That's right</button>`;
    } else {
      body = `
        <button class="pill willow" id="play" type="button" hidden>Play question</button>
        <button class="talk" id="talk" type="button">${MIC_SVG}<span>Hold to answer</span></button>`;
    }
    app.innerHTML = `
      <p class="eyebrow">Summo has a question</p>
      <h1 class="q">${esc(row.question)}</h1>
      ${body}
      <p class="err" role="alert"></p>
      <button class="pill quiet" id="decline" type="button">Not me / decline</button>`;

    const confirm = async (answer: string) => {
      if (!answer.trim()) return showErr('The answer is empty.');
      app.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        await convex.mutation(api.clarifications.confirm, { id: row._id, answer: answer.trim(), speaker: me!.name });
        stopTranscript?.(); call = undefined; doneUntil = Date.now() + 5000; setTimeout(render, 5100); render();
      } catch (e) { app.querySelectorAll('button').forEach((b) => (b.disabled = false)); showErr(`Not saved: ${plain(e)}`); }
    };
    app.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => (b.onclick = () => confirm(b.dataset.opt!)));
    $<HTMLButtonElement>('#decline').onclick = async () => {
      try { await convex.mutation(api.clarifications.decline, { id: row._id, reason: 'declined on phone' }); stopTranscript?.(); call = undefined; render(); }
      catch (e) { showErr(`Couldn't decline: ${plain(e)}`); }
    };
    const yes = $<HTMLButtonElement>('#yes');
    if (yes) yes.onclick = () => confirm(c.phase === 'edit' ? $<HTMLTextAreaElement>('#fix').value : c.transcript);
    const edit = $<HTMLButtonElement>('#edit');
    if (edit) edit.onclick = () => { c.phase = 'edit'; render(); $<HTMLTextAreaElement>('#fix').focus(); };
    const dict = $<HTMLButtonElement>('#dictate');
    if (dict) dict.onclick = () => {
      dict.textContent = 'Listening… tap to stop';
      let text = '';
      const stop = dictate((t) => { text = t; dict.textContent = t; }, () => { if (text) { c.transcript = text; c.micFailed = false; c.phase = 'review'; render(); } });
      dict.onclick = stop;
    };
    if (!reask && c.phase === 'ask') wireAsk(row, c);
  }

  function wireAsk(row: Row, c: Call) {
    // Question audio: autoplay once; iOS blocks it without a tap, so offer the button then.
    const play = $<HTMLButtonElement>('#play');
    const playAudio = async () => {
      if (!row.questionAudioId) return;
      const url = await convex.query(api.clarifications.audioUrl, { storageId: row.questionAudioId });
      if (url) await new Audio(url).play();
    };
    if (row.questionAudioId) {
      play.onclick = () => playAudio().then(() => (play.hidden = true)).catch((e) => showErr(`Can't play: ${plain(e)}`));
      if (!c.played) { c.played = true; playAudio().catch(() => (play.hidden = false)); } else play.hidden = false;
    }

    // Mic unavailable: tell Convex (status fallback_text, docs/frontend-guide.md §8) and show the option buttons.
    const micFail = () => { c.phase = 'ask'; c.micFailed = true; render(); convex.mutation(api.clarifications.fallbackText, { id: row._id }).catch(() => {}); };
    if (!navigator.mediaDevices?.getUserMedia) return micFail();
    const talk = $<HTMLButtonElement>('#talk');
    let rec: Promise<() => Promise<Blob>> | undefined, t0 = 0;
    talk.onpointerdown = (e) => {
      talk.setPointerCapture(e.pointerId);
      c.phase = 'recording'; t0 = Date.now();
      talk.classList.add('on'); talk.querySelector('span')!.textContent = 'Listening… let go to send';
      rec = startRecording();
      rec.catch(micFail);
    };
    talk.onpointerup = talk.onpointercancel = async () => {
      if (!rec) return;
      const r = rec; rec = undefined;
      let stop: () => Promise<Blob>;
      try { stop = await r; } catch { return; } // micFailed path already rendered
      const wav = await stop();
      if (Date.now() - t0 < 600) { c.phase = 'ask'; render(); return showErr('Hold the button while you talk.'); }
      c.phase = 'transcribing'; render();
      try {
        await convex.mutation(api.clarifications.startAnswer, { id: row._id });
        await convex.mutation(api.clarifications.submitAnswerAudio, { id: row._id, storageId: await upload(wav) });
        stopTranscript?.();
        stopTranscript = convex.onUpdate(api.transcript.byClarification, { id: row._id }, (segs) => {
          if (!segs.length || call !== c || c.phase !== 'transcribing') return;
          c.transcript = segs.sort((a, b) => a.seq - b.seq).map((s) => s.text).join(' ');
          c.phase = 'review'; render();
        });
      } catch (e) { c.phase = 'ask'; render(); showErr(`Didn't send: ${plain(e)}`); }
    };
  }

  // ---- live state ----
  convex.onUpdate(api.clarifications.active, {}, (row) => {
    active = row;
    if (row && call?.id !== row._id) { stopTranscript?.(); call = { id: row._id, phase: 'ask', transcript: '', micFailed: false, played: false }; }
    if (!row && call) { stopTranscript?.(); call = undefined; } // confirmed elsewhere, reset, or declined
    if (call && (call.phase === 'recording' || call.phase === 'edit') && row?.status !== 'fallback_text') return; // don't wipe the user's hands
    render();
  });
  convex.onUpdate(api.managers.current, {}, (cur) => {
    if (!me || cur?._id === me.id) return;
    // Reset (null) or someone else joined: back to screen 1 (docs/frontend-guide.md §8).
    me = null; sessionStorage.removeItem('keel-manager'); sessionStorage.removeItem('keel-sent'); sent = [];
    ledger?.disconnect(); ledger = undefined; ledgerState = 'offline'; paintConn(); render();
  });

  render();
  if (me) connectLedger(me.name).catch(() => { ledgerState = 'offline'; paintConn(); });
}
