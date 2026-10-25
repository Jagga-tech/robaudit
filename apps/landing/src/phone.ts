// Judge's phone page: docs/frontend-guide.md §8 (screens, audio contract), docs/demo-flow.md steps 1, 2, 4, 6.
import { DbConnection } from '@keel/bindings';
import { api, convex, getAuthState, sessionId, signInAnonymously } from './lib/convex';
import { usd } from './lib/ledger';
import type { Doc, Id } from '../../../convex/_generated/dataModel';

const STDB_URI = import.meta.env.VITE_STDB_URI ?? 'wss://maincloud.spacetimedb.com';
const STDB_DB = import.meta.env.VITE_STDB_DB ?? 'keel';
const ROLE = 'deployment_manager';
const MIC_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

type Me = { id: Id<'managers'>; name: string };
type Row = Doc<'clarifications'>;
// After Join: pick a path; 'intake' = onboarded project waiting for Summo's questions, 'project' = onboarded and answered.
type Mode = 'oakland' | 'onboard' | 'intake' | 'project';
type Sent = { text: string; at: number };
type Answer = 'additional' | 'new_total';
// One screen state machine for the call, kept locally so live updates don't wipe a recording or an edit in progress.
// ask -> recording -> sending -> transcribing -> heard (matched) | choose (option buttons); edit from heard/choose.
type Phase = 'ask' | 'recording' | 'sending' | 'transcribing' | 'heard' | 'choose' | 'edit';
type Call = {
  id: Id<'clarifications'>; phase: Phase; transcript: string; note: string; micFailed: boolean; played: boolean;
  segs: number; waitFrom: number; // transcript segments seen / count when the last answer was submitted
  busy: boolean; // confirm/decline in flight: double taps no-op, and its own `active -> null` is not "stale"
  unsub?: () => void; timer?: ReturnType<typeof setTimeout>; cancelRec?: () => void;
};

const MIN_HOLD = 400, MAX_HOLD = 8000, TRANSCRIPT_WAIT = 12_000, CELEBRATE = 2200;
const UPLOAD_FAILED = "The recording didn't send. Tap your answer.";
const STALE = 'That question was answered. Waiting for the next one.';
const NO_FIGURE = "I didn't catch a figure. Type it or try again.";
const IDLE_MS = 20 * 60 * 1000;

// Verbatim copy of parseAmountCents (and NUM, WORD_MULT) from apps/agent/src/extract.ts: keep in sync.
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmM]))?(?![A-Za-z\d])`;
const WORD_MULT = /^\s*(million|billion|thousand|mm|bn)\b/i;
export function parseAmountCents(amountText: string): bigint | null {
  const neg = /^\s*(-|\u2212|minus\b)/i.test(amountText);
  const m = amountText.includes("$")
    ? amountText.match(new RegExp(String.raw`\$\s?` + NUM))
    : amountText.match(new RegExp(NUM));
  const rest = m ? amountText.slice(m.index! + m[0].length) : "";
  if (!m || WORD_MULT.test(rest)) return null;
  const mult = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as "k" | "m"] ?? (!m[2] && /^\s*grand\b/i.test(rest) ? 1e3 : 1);
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? BigInt(Math.round(n * mult * 100)) * (neg ? -1n : 1n) : null;
}

// Verbatim copy of parseSpokenCents from apps/agent/src/extract.ts: keep in sync.
// Spoken amounts from a phone answer: "5 million", "four hundred thousand dollars", "400k", "a million", "half a million", "1,000,000".
// The first figure wins and the words after it are ignored ("5 million for 7 months" -> 5,000,000). Null when no figure.
const SMALL: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const BIG: Record<string, number> = { thousand: 1e3, k: 1e3, grand: 1e3, million: 1e6, mil: 1e6, mm: 1e6, m: 1e6, billion: 1e9, bn: 1e9 };
export function parseSpokenCents(text: string): bigint | null {
  const t0 = text.toLowerCase();
  if (/\bpercent\b|%|\bbetween\b/.test(t0)) return null; // a share or a range is not a figure
  const toks = t0.replace(/(\d),(?=\d)/g, '$1').replace(/(\d)([km])\b/g, '$1 $2').split(/[^a-z0-9./]+/).filter(Boolean);
  let total = 0, cur = 0, seen = false, lastBig = 0, prevDigits = false, point = 0;
  const isNum = (x: string | undefined) => !!x && (/^\d/.test(x) || x in SMALL || x === 'a' || x === 'half');
  for (const [i, t] of toks.entries()) {
    const frac = t.match(/^(\d+)\/(\d+)$/);
    if (frac) { cur += Number(frac[1]) / Number(frac[2]); seen = true; prevDigits = true; continue; } // "1/2 million"
    if (/^\d+(\.\d+)?$/.test(t)) {
      if (point) { cur += Number(t) / 10 ** (point + t.length - 1); point += t.length; } // "one point five"
      else if (prevDigits && cur && /^\d{3}$/.test(t)) cur = cur * 1000 + Number(t); // "400 000"
      else if (seen && cur) break;
      else cur += Number(t);
      seen = true; prevDigits = true; continue;
    }
    prevDigits = false;
    if (t in SMALL) { if (point) { cur += SMALL[t] / 10 ** point; point++; } else cur += SMALL[t]; seen = true; }
    else if (t === 'point') point = 1;
    else if (t === 'half' || t === 'quarter') { const f = t === 'half' ? 0.5 : 0.25; if (!cur && lastBig) total += f * lastBig; else cur += f; seen = true; } // "half a million", "a million and a half"
    else if (t === 'hundred') { cur = (cur || 1) * 100; seen = true; }
    else if (t in BIG) { total += (cur || 1) * BIG[t]; lastBig = BIG[t]; cur = 0; point = 0; seen = true; }
    else if ((t === 'to' || t === 'or') && seen) { if (isNum(toks[i + 1])) return null; break; } // "2 to 3 million" is a range; "200k to finish" is not
    else if (!seen && /^(nothing|none|nil|zero|nada|haven)/.test(t)) { if (!/\d|hundred|thousand|million|billion/.test(t0)) return 0n; } // "nothing yet", "we haven't billed anything"
    else if (seen && t !== 'and' && t !== 'a' && t !== 'of') break;
  }
  return seen ? BigInt(Math.round((total + cur) * 100)) : null;
}

// A spoken total: rejects a rate ("half a million a month") unless a duration follows ("for seven months"), then multiplies.
// cents null -> `note` says why (shown to the speaker); cents set -> `note` is the arithmetic when a rate was expanded, else ''.
const RATE = /\b(?:a|per|each|every)\s+(month|week|day|year)\b|\b(month|week|dai|year)ly\b|\bannual(?:ly)?\b/;
const UNIT: Record<string, string> = { dai: 'day', annual: 'year', annually: 'year' };
export function parseSpokenTotal(text: string): { cents: bigint | null; note: string } {
  const t0 = text.toLowerCase();
  const rate = t0.match(RATE);
  const cents = parseSpokenCents(text);
  if (!rate || cents === null) return { cents, note: '' };
  const unit = UNIT[rate[1] ?? rate[2] ?? 'annual'] ?? rate[1] ?? rate[2];
  const dur = t0.slice(rate.index! + rate[0].length).match(new RegExp(String.raw`\b(?:for|over|across|during)\s+(.+?)\s+${unit}s?\b`));
  const n = dur ? parseSpokenCents(dur[1]) : null;
  if (n === null || n <= 0n || n > 100000n) return { cents: null, note: `That sounds like a ${unit}ly figure. What is the total?` };
  const count = Number(n / 100n);
  return { cents: cents * BigInt(count), note: `${usdWhole(cents)} a ${unit} for ${count} ${unit}${count === 1 ? '' : 's'}` };
}
const usdWhole = (c: bigint) => '$' + (c / 100n).toLocaleString('en-US');

// Same rule the agent applies to the confirmed answer: regexes copied verbatim from normalizeAnswer in
// apps/agent/src/loop.ts (keep in sync). Both or neither -> null -> the phone asks which one; never confirms a guess.
const TOTAL = /new[\s_-]*total|\btotal\b/i, ADD = /addition|on top|\bmore\b|\bextra\b/i;
const normalize = (a: string): Answer | null => {
  const total = TOTAL.test(a), add = ADD.test(a);
  return total === add ? null : total ? 'new_total' : 'additional';
};
/** The judge's words -> the option they meant, or null. Only options the question offered count. */
export function matchAnswer(text: string, options: string[]): Answer | null {
  const m = normalize(text);
  return m && (!options.length || options.some((o) => normalize(o) === m)) ? m : null;
}
/** Transcript HTML with the matched phrase in <mark>; long side chatter is cut down to that phrase alone. */
function heardHtml(text: string, m: Answer | null): string {
  const hit = m ? (m === 'new_total' ? TOTAL : ADD).exec(text) : null;
  if (!hit) return esc(text);
  let a = hit.index, b = a + hit[0].length;
  while (a > 0 && /\w/.test(text[a - 1])) a--; // widen "addition" to "additional"
  while (b < text.length && /\w/.test(text[b])) b++;
  const mark = `<mark>${esc(text.slice(a, b))}</mark>`;
  return text.length > 80 ? `…${mark}…` : esc(text.slice(0, a)) + mark + esc(text.slice(b));
}
/** Reject when `p` takes longer than `ms`. */
const within = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

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
const DOTS = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';

if (typeof document !== 'undefined') boot();

function boot() {
  const app = document.getElementById('app')!;
  const connLine = document.getElementById('conn')!;
  const summo = document.querySelector('.summo')!;
  const oops = document.getElementById('oops')!;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches; // no animation classes at all
    const load = <T>(k: string, d: T): T => { try { return JSON.parse(sessionStorage.getItem(k) ?? '') as T; } catch { return d; } };

  let me = load<Me | null>('keel-manager', null);
  let sent = load<Sent[]>('keel-sent', []);
  let mode = load<Mode | null>('keel-mode', null);
  let project = load<string>('keel-project', 'Oakland deployment'); // the project Home sends to; ids change after reset, names don't
  const setMode = (m: Mode | null) => { mode = m; sessionStorage.setItem('keel-mode', JSON.stringify(m)); };
  let ledger: DbConnection | undefined;
  let ledgerState = 'offline';
  let convexErr = false;
  let active: Row | null = null;
  let call: Call | undefined;
  let doneUntil = 0;
  let homeNote = '';
  let endedUntil = 0, idleTimer: ReturnType<typeof setTimeout> | undefined;
  const idleMs = Number(new URLSearchParams(location.search).get('idle')) * 1000 || IDLE_MS; // ?idle=<seconds> for tests

  const $ = <T extends HTMLElement>(sel: string) => app.querySelector(sel) as T;
  const showErr = (msg: string) => { const e = $('.err'); if (e) e.textContent = msg; };
  const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^.*?Uncaught Error:\s*/s, '').split('\n')[0];

  // ---- never die: stray rejections/errors get one inline line and a Retry, never a frozen screen ----
  const oopsMsg = oops.querySelector('span')!;
  const fail = (e: unknown) => { oopsMsg.textContent = `Something went wrong: ${plain(e)}`; oops.hidden = false; };
  addEventListener('unhandledrejection', (e) => { e.preventDefault(); fail(e.reason); });
  addEventListener('error', (e) => fail(e.error ?? e.message));
  oops.querySelector('button')!.onclick = () => { oops.hidden = true; ensureLedger(); render(); };
  // Back/forward cache restores a page with dead sockets: reload, and the resume path below rebuilds the screen.
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

  function paintConn() {
    const c = convex.connectionState();
    const down = convexErr || ledgerState === 'reconnecting' || (c.hasEverConnected && !c.isWebSocketConnected);
    connLine.classList.toggle('warn', down);
    const sid = sessionId(); // Convex Auth anonymous session; display only, the call flow does not wait on it
    connLine.textContent = down ? 'Reconnecting…' : `ledger: ${ledgerState} · convex: ${c.isWebSocketConnected ? 'online' : 'connecting'} · session: ${getAuthState() === 'ok' ? (sid ? 'ok ' + sid : 'ok') : getAuthState() === 'failed' ? 'none (confirm may be refused)' : 'signing in…'}`;
  }
  convex.subscribeToConnectionState(paintConn); // ConvexClient reconnects its own socket and replays subscriptions

  const unauth = (e: unknown) => /unauthenticated|not signed in|sign.?in/i.test(plain(e));
  /** Run a mutation; if refused as unauthenticated, re-sign-in once (4 s) and retry once. */
  async function authed<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (e) {
      if (!unauth(e)) throw e;
      await signInAnonymously(); paintConn();
      try { return await run(); } catch (e2) { if (unauth(e2)) throw new Error('Could not confirm from this phone. Tap the option on the laptop.'); throw e2; }
    }
  }

  /** onUpdate that survives query errors: show Reconnecting…, resubscribe with backoff. */
  function watch<T>(sub: (cb: (v: T) => void, onErr: (e: Error) => void) => () => void, cb: (v: T) => void): () => void {
    let stop: () => void, dead = false, wait = 1000;
    const go = () => {
      stop = sub((v) => { wait = 1000; if (convexErr) { convexErr = false; paintConn(); } cb(v); }, () => {
        convexErr = true; paintConn(); stop();
        setTimeout(() => { if (!dead) go(); }, wait); wait = Math.min(wait * 2, 15_000);
      });
    };
    go();
    return () => { dead = true; stop(); };
  }

  // ---- SpacetimeDB (docs/frontend-guide.md §4): one identity per role, rebuilt with backoff when it drops ----
  let ledgerWait = 1000, ledgerTimer: ReturnType<typeof setTimeout> | undefined;
  async function connectLedger(name: string) {
    const old = ledger; ledger = undefined; old?.disconnect(); // ledger cleared first so old's onDisconnect doesn't retry
    if (ledgerState !== 'reconnecting') ledgerState = 'connecting';
    paintConn();
    const key = `keel-token-${ROLE}`;
    let conn: DbConnection | undefined;
    const c = await within(new Promise<DbConnection>((resolve, reject) => {
      conn = DbConnection.builder()
        .withUri(STDB_URI).withDatabaseName(STDB_DB)
        .withToken(localStorage.getItem(key) ?? undefined)
        .onConnect((c, _id, token) => { localStorage.setItem(key, token); resolve(c); })
        .onConnectError((_ctx, e) => reject(e))
        .onDisconnect(() => { if (ledger === conn) { ledger = undefined; retryLedger(); } })
        .build();
    }), 10_000, 'ledger connect').catch((e) => { conn?.disconnect(); throw e; });
    await within(new Promise<void>((resolve, reject) => {
      c.subscriptionBuilder().onApplied(() => resolve()).onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
        .subscribe(['SELECT * FROM user', 'SELECT * FROM project', 'SELECT * FROM source']);
    }), 10_000, 'ledger subscribe').catch((e) => { c.disconnect(); throw e; });
    const u = c.db.user.identity.find(c.identity!);
    if (!u || u.role !== ROLE || u.name !== name) await c.reducers.registerDemoUser({ name, role: ROLE });
    if (me?.name !== name) return c.disconnect(); // reset while connecting
    ledger = c; ledgerState = 'online'; ledgerWait = 1000; paintConn();
  }
  function retryLedger() {
    if (!me || ledgerTimer) return;
    ledgerState = 'reconnecting'; paintConn();
    ledgerTimer = setTimeout(() => {
      ledgerTimer = undefined;
      if (me) connectLedger(me.name).catch(() => { ledgerWait = Math.min(ledgerWait * 2, 15_000); retryLedger(); });
    }, ledgerWait);
  }
  const ensureLedger = () => { if (me && !ledger && ledgerState !== 'connecting') retryLedger(); };

  /** addSource as the deployment manager. Project looked up at send time: ids change after reset (docs/demo-flow.md, reset). */
  async function ready(): Promise<DbConnection> {
    // Fresh join or a dropped socket: wait for the (re)connection rather than failing the tap.
    for (let t = 0; !ledger && t < 50; t++) { ensureLedger(); await new Promise((r) => setTimeout(r, 200)); }
    if (!ledger) throw new Error('Not connected to the ledger yet. Try again in a moment.');
    return ledger;
  }
  async function addSource(kind: string, text: string) {
    const ledger = await ready();
    const projects = [...ledger.db.project.iter()];
    const p = projects.find((x) => x.name === project) ?? projects[0];
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

  // ---- the call: state survives reloads in sessionStorage ----
  const save = (c: Call) => sessionStorage.setItem('keel-call', JSON.stringify({ id: c.id, phase: c.phase, transcript: c.transcript, note: c.note, waitFrom: c.waitFrom }));
  const go = (c: Call, phase: Phase, note = '') => { clearTimeout(c.timer); c.phase = phase; c.note = note; save(c); if (call === c) render(); };

  function startCall(row: Row): Call {
    const c: Call = { id: row._id, phase: 'ask', transcript: '', note: '', micFailed: false, played: false, segs: -1, waitFrom: 0, busy: false };
    const saved = load<Partial<Call> | null>('keel-call', null);
    if (saved?.id === row._id) {
      Object.assign(c, { transcript: saved.transcript ?? '', note: saved.note ?? '', waitFrom: saved.waitFrom ?? 0, played: true });
      const p = saved.phase ?? 'ask';
      if (p === 'recording') c.phase = 'choose', c.note = UPLOAD_FAILED; // the audio died with the page
      else if (p === 'sending' || p === 'transcribing') { c.phase = 'transcribing'; armTimeout(c); }
      else c.phase = p === 'edit' ? (matchAnswer(c.transcript, row.options) ? 'heard' : 'choose') : p;
    }
    c.unsub = watch<Doc<'transcriptSegments'>[]>((cb, er) => convex.onUpdate(api.transcript.byClarification, { id: row._id }, cb, er), (segs) => {
      c.segs = segs.length;
      const waiting = c.phase === 'sending' || c.phase === 'transcribing' || ((c.phase === 'choose' || c.phase === 'ask') && c.note === TIMEOUT_NOTE);
      if (segs.length <= c.waitFrom || !waiting || c.busy) return;
      c.waitFrom = segs.length;
      c.transcript = segs.sort((a, b) => a._creationTime - b._creationTime).at(-1)!.text.trim();
      lastTranscript.push(c.transcript);
      go(c, ...next(row, c.transcript, "Summo didn't hear an answer. Tap your answer."));
    });
    save(c);
    return c;
  }
  const TIMEOUT_NOTE = 'Summo is still listening. Tap your answer.';
  const isAmount = (row: Row) => row.answerType === 'amount';
  /** Where an answer text leads: amount -> heard (parsed) | ask with the catch line; choice -> heard (matched) | choose. */
  const next = (row: Row, text: string, empty = ''): [Phase, string] => isAmount(row)
    ? (parseSpokenTotal(text).cents === null ? ['ask', parseSpokenTotal(text).note || (text.trim() ? `Heard “${text.trim()}”, but no figure. Type it or try again.` : NO_FIGURE)] : ['heard', ''])
    : [matchAnswer(text, row.options) ? 'heard' : 'choose', text ? '' : empty];
  const lastTranscript: string[] = ((window as any).__phoneTranscripts = []); // read by tests/phone.e2e.mjs
  function armTimeout(c: Call) {
    clearTimeout(c.timer);
    c.timer = setTimeout(() => { if (c.phase === 'transcribing') go(c, 'choose', TIMEOUT_NOTE); }, TRANSCRIPT_WAIT);
  }
  function endCall() {
    if (!call) return;
    clearTimeout(call.timer); call.unsub?.(); call.cancelRec?.();
    call = undefined; sessionStorage.removeItem('keel-call');
  }

  // ---- screens ----
  function render() {
    document.body.classList.toggle('ring', !!active && !calm);
    const done = Date.now() < doneUntil;
    summo.classList.toggle('bounce', done && !calm);
    document.body.classList.toggle('celebrate', done && !calm);
    if (Date.now() < endedUntil) return renderEnded();
    if (!me) return renderJoin();
    if (active && call?.id === active._id) return renderCall(active, call);
    if (done) return renderDone();
    if (!mode) return renderPick();
    if (mode === 'onboard') return renderOnboard();
    renderHome();
  }

  function renderEnded() {
    const mins = idleMs / 60_000;
    app.innerHTML = `<h1>Session ended after ${mins >= 1 ? `${mins} minutes` : `${idleMs / 1000} seconds`} of inactivity.</h1>`;
  }

  function renderPick() {
    app.innerHTML = `
      <p class="eyebrow">Robaudit</p>
      <h1>Hi ${esc(me!.name)}. What are you here for?</h1>
      <button class="pill dark big" id="oak" type="button">Join the Oakland deployment</button>
      <button class="pill outline big" id="onb" type="button">Onboard a new project</button>`;
    $<HTMLButtonElement>('#oak').onclick = () => { project = 'Oakland deployment'; sessionStorage.setItem('keel-project', JSON.stringify(project)); setMode('oakland'); render(); };
    $<HTMLButtonElement>('#onb').onclick = () => { setMode('onboard'); render(); };
  }

  // Typed values survive re-renders (a ledger update or a question arriving redraws the screen while the judge types).
  const onb = { name: 'Art installation', customer: 'CalHacks' };
  function renderOnboard() {
    app.innerHTML = `
      <p class="eyebrow">Robaudit · New project</p>
      <h1>Onboard a new project.</h1>
      <form class="stack" id="onboard">
        <label for="pname">Project name</label>
        <input id="pname" type="text" maxlength="60" required value="${esc(onb.name)}">
        <label for="cust">Customer</label>
        <input id="cust" type="text" maxlength="60" required value="${esc(onb.customer)}">
        <p class="err" role="alert"></p>
        <button class="pill dark" type="submit">Create project</button>
      </form>
      <button class="pill quiet" id="back" type="button">Back</button>`;
    $<HTMLButtonElement>('#back').onclick = () => { setMode(null); render(); };
    $<HTMLInputElement>('#pname').oninput = (e) => { onb.name = (e.target as HTMLInputElement).value; };
    $<HTMLInputElement>('#cust').oninput = (e) => { onb.customer = (e.target as HTMLInputElement).value; };
    let creating = false;
    $<HTMLFormElement>('#onboard').onsubmit = async (ev) => {
      ev.preventDefault();
      if (creating) return; // double tap
      const name = $<HTMLInputElement>('#pname').value.trim(), customer = $<HTMLInputElement>('#cust').value.trim();
      if (!name || !customer) return showErr('Fill in the project and the customer.');
      creating = true;
      const btn = $<HTMLButtonElement>('#onboard button'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        // TODO: type this call once the createProject bindings are in every deployed @keel/bindings (idempotent per name).
        await within(ready().then((l) => (l.reducers as any).createProject({ name, customer })), 15_000, 'Create project');
      } catch (e) { creating = false; btn.disabled = false; btn.textContent = 'Create project'; return showErr(`Not created: ${plain(e)}`); }
      if (mode !== 'onboard') return; // reset or idle-out while waiting
      project = name; sessionStorage.setItem('keel-project', JSON.stringify(project));
      setMode('intake'); render();
    };
  }

  function renderJoin() {
    app.innerHTML = `
      <p class="eyebrow">Robaudit</p>
      <h1>You are the deployment manager.</h1>
      <form class="stack" id="join">
        <label for="name">Your first name</label>
        <input id="name" type="text" autocomplete="given-name" autocapitalize="words" maxlength="40" required>
        <p class="err" role="alert"></p>
        <button class="pill dark" type="submit">Join</button>
      </form>`;
    let joining = false;
    $<HTMLFormElement>('#join').onsubmit = async (ev) => {
      ev.preventDefault();
      if (joining) return; // double tap / double Enter
      const name = $<HTMLInputElement>('#name').value.trim();
      if (!name) return showErr('Type your first name.');
      joining = true;
      const btn = $<HTMLButtonElement>('button'); btn.disabled = true; btn.textContent = 'Joining…';
      try {
        const id = await convex.mutation(api.managers.join, { name });
        me = { id, name }; sessionStorage.setItem('keel-manager', JSON.stringify(me)); poke();
      } catch (e) {
        joining = false; btn.disabled = false; btn.textContent = 'Join'; return showErr(`Couldn't join: ${plain(e)}`);
      }
      render();
      connectLedger(name).catch(() => retryLedger());
    };
  }

  function renderHome() {
    app.innerHTML = `
      <h1>${mode === 'intake' ? 'Summo will call you with a few questions.' : mode === 'project' ? 'Anything changed on site this week? Send it.' : `Hi ${esc(me!.name)}. Send Summo a site update.`}</h1>
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
    if (homeNote === STALE) after(STALE);

    let stopMic: (() => void) | undefined;
    const mic = $<HTMLButtonElement>('#mic');
    mic.onclick = () => {
      if (stopMic) return stopMic();
      mic.classList.add('on');
      try { stopMic = dictate((t) => { ta.value = t; }, () => { stopMic = undefined; mic.classList.remove('on'); }); }
      catch { mic.hidden = true; } // typing always works
    };

    let sending = false;
    $<HTMLButtonElement>('#send').onclick = async (ev) => {
      if (sending) return;
      const text = ta.value.trim();
      if (!text) return showErr('Type or say an update first.');
      stopMic?.();
      const btn = ev.currentTarget as HTMLButtonElement; btn.disabled = true; sending = true;
      try { await within(addSource('note', text), 15_000, 'Send'); log(text); after('Sent. Summo is reading…'); render(); }
      catch (e) { sending = false; btn.disabled = false; showErr(`Not sent: ${plain(e)}`); }
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
    app.innerHTML = `<h1 class="thanks">Thanks, ${esc(me!.name)}. Summo is booking it with your name on it.</h1>`;
  }

  function renderCall(row: Row, c: Call) {
    const amt = isAmount(row);
    // Amount questions have no option buttons: every "tap your answer" fallback lands on the typed field instead.
    if (amt && (c.phase === 'choose' || c.phase === 'edit')) c.phase = 'ask';
    if (!amt && row.status === 'fallback_text' && (c.phase === 'ask' || c.phase === 'heard')) { c.phase = 'choose'; c.note ||= "Summo didn't catch that. Tap your answer."; }
    const m = matchAnswer(c.transcript, row.options);
    const options = row.options.map((o, i) => `<button class="pill ${i ? 'outline' : 'dark'}" data-opt="${esc(o)}" type="button">${esc(label(o))}</button>`).join('');
    const againBtn = c.micFailed ? (SR ? '<button class="pill quiet" id="dictate" type="button">Say it instead</button>' : '') : '<button class="pill quiet" id="again" type="button">Say it again</button>';
    let body: string;
    if (c.phase === 'sending' || c.phase === 'transcribing') {
      body = `<p class="lede" id="wait">${c.phase === 'sending' ? 'Sending your answer' : 'Transcribing'}${calm ? '…' : DOTS}</p>`;
    } else if (amt && c.phase === 'heard') {
      body = `
        <p class="lede" id="heard">I heard ${parseSpokenTotal(c.transcript).note ? `${esc(parseSpokenTotal(c.transcript).note)}, so ` : ''}${usd(parseSpokenTotal(c.transcript).cents ?? 0n)}. Is that right?</p>
        <button class="pill dark" id="yes" type="button">That's right</button>
        <button class="pill outline" id="edit" type="button">Edit</button>`;
    } else if (amt) {
      body = `
        <p class="note">${esc(c.note.replace('Tap your answer.', 'Type it instead.'))}</p>
        <button class="pill willow" id="play" type="button" hidden>Play question</button>
        ${c.micFailed ? '' : `<button class="talk${calm ? '' : ' asking'}" id="talk" type="button">${MIC_SVG}<span>Hold to answer</span></button>`}
        <form class="stack" id="amt">
          <label for="amount">Or type the figure</label>
          <div class="money"><span aria-hidden="true">$</span><input id="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="400,000" value="${esc(c.transcript)}"></div>
          <button class="pill dark" type="submit">Check figure</button>
        </form>
        <p class="note small">Your spoken answer is recorded, transcribed by Cartesia and kept as evidence on the ledger with your name.</p>`;
    } else if (c.phase === 'heard') {
      body = `
        <div class="card transcript">${heardHtml(c.transcript, m)}</div>
        ${c.transcript.length > 80 ? `<p class="raw">Heard: “${esc(c.transcript)}”</p>` : ''}
        <button class="pill dark" id="yes" type="button" ${m ? '' : 'disabled'}>That's right</button>
        <button class="pill outline" id="edit" type="button">Edit</button>
        <button class="pill quiet" id="again" type="button">Say it again</button>`;
    } else if (c.phase === 'choose') {
      const lede = c.transcript && c.note !== TIMEOUT_NOTE ? `I heard: “${esc(c.transcript)}”. Which did you mean?`
        : c.transcript ? esc(c.note) : esc(c.note || 'Tap your answer.');
      body = `<p class="lede" id="choose">${lede}</p>${options}${c.transcript ? '<button class="pill quiet" id="edit" type="button">Edit</button>' : ''}${againBtn}`;
    } else if (c.phase === 'edit') {
      body = `
        <textarea id="fix" aria-label="Your answer">${esc(c.transcript)}</textarea>
        <button class="pill dark" id="yes" type="button">That's right</button>`;
    } else {
      body = `
        <p class="note">${esc(c.note)}</p>
        <button class="pill willow" id="play" type="button" hidden>Play question</button>
        <button class="talk${calm ? '' : ' asking'}" id="talk" type="button">${MIC_SVG}<span>Hold to answer</span></button>
        <button class="pill quiet" id="tap" type="button">Tap an answer instead</button>
        <p class="note small">Your spoken answer is recorded, transcribed by Cartesia and kept as evidence on the ledger with your name.</p>`;
    }
    app.innerHTML = `
      <p class="eyebrow">Summo has a question</p>
      <h1 class="q">${esc(row.question)}</h1>
      ${body}
      <p class="err" role="alert"></p>
      <button class="pill quiet" id="decline" type="button">Not me / decline</button>`;

    const lock = (on: boolean) => app.querySelectorAll('button').forEach((b) => (b.disabled = on));
    /** Only canonical answers reach Convex: a matched transcript or a tapped option. */
    const confirm = async (answer: string) => {
      if (c.busy) return; // double tap
      c.busy = true; lock(true);
      try {
        await authed(() => convex.mutation(api.clarifications.confirm, { id: row._id, answer, speaker: me!.name })); // no-op if already confirmed
        if (call === c) endCall();
        if (mode === 'intake') setMode('project');
        doneUntil = Date.now() + CELEBRATE; setTimeout(render, CELEBRATE + 50); render();
      } catch (e) { c.busy = false; lock(false); showErr(/^Could not confirm/.test(plain(e)) ? plain(e) : `Not saved: ${plain(e)}`); }
    };
    app.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => (b.onclick = () => confirm(normalize(b.dataset.opt!) ?? b.dataset.opt!)));
    $<HTMLButtonElement>('#decline').onclick = async () => {
      if (c.busy) return;
      c.busy = true; lock(true);
      try { await authed(() => convex.mutation(api.clarifications.decline, { id: row._id, reason: 'declined on phone' })); if (call === c) endCall(); render(); }
      catch (e) { c.busy = false; lock(false); showErr(/^Could not confirm/.test(plain(e)) ? plain(e) : `Couldn't decline: ${plain(e)}`); }
    };
    const yes = $<HTMLButtonElement>('#yes');
    if (yes) yes.onclick = () => {
      if (amt) { const cents = parseSpokenTotal(c.transcript).cents; return cents === null ? go(c, 'ask', NO_FIGURE) : confirm(String(cents)); }
      if (c.phase === 'edit') c.transcript = $<HTMLTextAreaElement>('#fix').value.trim();
      const hit = matchAnswer(c.transcript, row.options);
      if (hit) return confirm(hit);
      go(c, 'choose'); // edited text still ambiguous: the options are the only way through
    };
    const edit = $<HTMLButtonElement>('#edit');
    if (edit) edit.onclick = () => { go(c, amt ? 'ask' : 'edit'); $<HTMLElement>(amt ? '#amount' : '#fix').focus(); };
    const form = $<HTMLFormElement>('#amt');
    if (form) {
      const field = $<HTMLInputElement>('#amount');
      field.oninput = () => { c.transcript = field.value; }; // a live re-render keeps what was typed
      form.onsubmit = (ev) => { ev.preventDefault(); c.transcript = field.value.trim(); go(c, ...next(row, c.transcript)); };
    }
    const again = $<HTMLButtonElement>('#again');
    if (again) again.onclick = () => { c.transcript = ''; go(c, 'ask'); };
    const tap = $<HTMLButtonElement>('#tap');
    if (tap) tap.onclick = () => go(c, 'choose');
    const dict = $<HTMLButtonElement>('#dictate');
    if (dict) dict.onclick = () => {
      dict.textContent = 'Listening… tap to stop';
      let text = '';
      try {
        const stop = dictate((t) => { text = t; dict.textContent = t; }, () => { if (text) { c.transcript = text; c.micFailed = false; go(c, ...next(row, text)); } });
        dict.onclick = stop;
      } catch { dict.hidden = true; }
    };
    if (c.phase === 'ask') wireAsk(row, c);
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
      const blocked = () => { play.hidden = false; $('.note').textContent = 'Tap Play question to hear Summo, or just read it.'; };
      play.onclick = () => playAudio().then(() => (play.hidden = true)).catch((e) => showErr(`Can't play: ${plain(e)}`));
      if (!c.played) { c.played = true; playAudio().catch(blocked); } else play.hidden = false;
    }

    // Mic unavailable (no device, permission denied): tell Convex (status fallback_text, docs/frontend-guide.md §8) and show the options.
    const micFail = () => {
      if (call !== c) return;
      c.micFailed = true; go(c, 'choose', "The mic isn't available. Tap your answer.");
      convex.mutation(api.clarifications.fallbackText, { id: row._id }).catch(() => {});
    };
    if (c.micFailed) return; // amount screen without a talk button
    if (!navigator.mediaDevices?.getUserMedia) return micFail();
    const talk = $<HTMLButtonElement>('#talk');
    const span = talk.querySelector('span')!;
    let rec: Promise<() => Promise<Blob>> | undefined, t0 = 0, maxTimer: ReturnType<typeof setTimeout> | undefined;
    talk.onpointerdown = (e) => {
      if (rec || c.phase !== 'ask') return;
      try { talk.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
      c.phase = 'recording'; save(c); t0 = Date.now();
      talk.classList.add('on'); span.textContent = 'Listening… let go to send';
      rec = startRecording();
      rec.catch(micFail);
      maxTimer = setTimeout(finish, MAX_HOLD); // 8 s cap: auto-finalize
      c.cancelRec = () => { clearTimeout(maxTimer); const r = rec; rec = undefined; r?.then((stop) => stop()).catch(() => {}); };
    };
    talk.onpointerup = talk.onpointercancel = () => { finish(); };
    async function finish() {
      if (!rec) return; // already finalized (release after the 8 s cap, double release)
      clearTimeout(maxTimer);
      const r = rec; rec = undefined; c.cancelRec = undefined;
      const held = Date.now() - t0;
      let wav: Blob;
      try { wav = await (await r)(); } catch { return; } // micFail already rendered
      if (call !== c) return; // question went away while recording
      if (held < MIN_HOLD) { go(c, 'ask'); return showErr('Hold the button while you speak.'); }
      go(c, 'sending');
      try {
        await within((async () => {
          await convex.mutation(api.clarifications.startAnswer, { id: row._id });
          const storageId = await upload(wav);
          c.waitFrom = Math.max(c.segs, 0);
          await convex.mutation(api.clarifications.submitAnswerAudio, { id: row._id, storageId });
        })(), 15_000, 'Upload');
      } catch {
        if (call === c && c.phase === 'sending') go(c, 'choose', UPLOAD_FAILED);
        return;
      }
      if (call === c && c.phase === 'sending') { go(c, 'transcribing'); armTimeout(c); }
    }
  }

  // ---- live state ----
  watch<Row | null>((cb, er) => convex.onUpdate(api.clarifications.active, {}, cb, er), (row) => {
    const prev = call;
    active = row;
    if (prev && prev.id !== row?._id) {
      // Our question closed under us: someone else confirmed it, or a reset. Our own confirm/decline sets busy.
      const stale = !prev.busy;
      endCall();
      if (stale) homeNote = STALE;
      else if (!row) return; // our own confirm/decline renders its next screen
    }
    if (row && !call) { call = startCall(row); poke(); } // a new question counts as activity
    if (call && (call.phase === 'recording' || call.phase === 'edit') && row?.status !== 'fallback_text') return; // don't wipe the user's hands
    render();
  });
  watch<{ _id: Id<'managers'> } | null>((cb, er) => convex.onUpdate(api.managers.current, {}, cb, er), (cur) => {
    if (!me || cur?._id === me.id) return;
    // Reset (null) or someone else joined: back to screen 1 (docs/frontend-guide.md §8).
    dropMe(); render();
  });
  function dropMe() {
    me = null; sent = []; mode = null; project = 'Oakland deployment';
    for (const k of ['keel-manager', 'keel-sent', 'keel-mode', 'keel-project']) sessionStorage.removeItem(k);
    endCall(); clearTimeout(idleTimer);
    const old = ledger; ledger = undefined; old?.disconnect(); ledgerState = 'offline'; paintConn();
  }

  // ---- idle timeout: no tap, keystroke or new question for idleMs -> leave, forget the tab, back to Join ----
  function poke() { clearTimeout(idleTimer); if (me) idleTimer = setTimeout(idleOut, idleMs); }
  for (const ev of ['pointerdown', 'keydown', 'input']) addEventListener(ev, poke, true);
  function idleOut() {
    if (!me) return;
    const id = me.id;
    dropMe(); sessionStorage.clear();
    convex.mutation(api.managers.leave, { id }).catch(() => {}); // managers.current -> null clears the laptop presence line
    endedUntil = Date.now() + 3000; setTimeout(render, 3050); render();
  }

  render();
  signInAnonymously().then(paintConn); // never rejects, never blocks Join/Send; call mutations need the session; queries work without it
  connLine.onclick = () => { const sid = sessionId(); if (sid) alert(`Convex Auth session ${sid}: your answers are recorded against this session, not just your name.`); };
  if (me) { poke(); connectLedger(me.name).catch(() => retryLedger()); }
}
