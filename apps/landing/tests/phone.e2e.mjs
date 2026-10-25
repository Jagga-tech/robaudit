// Phone page end-to-end (judge flow, hardening). Needs: local SpacetimeDB, Convex from .env, `pnpm agent`, and the dev server
// (`pnpm --filter @keel/web dev`). Run `pnpm demo --reset-only` first. Usage: PHONE_URL=http://127.0.0.1:5173 pnpm --filter @keel/web test:phone
// Chromium's fake mic feeds a tone into the REAL record -> WAV -> upload -> submitAnswerAudio -> Cartesia path; a tone is not an
// answer, so the page must fall to the option buttons ("only accept a real answer").
import { chromium } from 'playwright';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';
import { readFileSync, mkdirSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url);
const env = {};
for (const f of ['.env', '.env.local']) {
  try { for (const l of readFileSync(new URL(f, ROOT), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); } } catch {}
}
const BASE = process.env.PHONE_URL ?? 'http://127.0.0.1:5288';
const cvx = new ConvexHttpClient(process.env.VITE_CONVEX_URL ?? env.VITE_CONVEX_URL ?? env.CONVEX_URL);
const SHOTS = new URL('.superpowers/sdd/2026-10-24-keel-backend/web-shots/', ROOT).pathname;
mkdirSync(SHOTS, { recursive: true });
const STALE = 'That question was answered. Waiting for the next one.';
const WI = 'ph2-test';

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const results = {}, transcripts = [], pageErrors = [];
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

async function phone({ proxyWs = false, ...opts } = {}) {
  await cvx.mutation(api.clarifications.resetOpen, {}); // no question left over from the previous scenario
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'], ...opts });
  const page = await ctx.newPage();
  const sent = {};
  page.on('websocket', (ws) => ws.on('framesent', (f) => {
    const m = String(f.payload).match(/"udfPath":"([^"]+)"/); if (m && /"type":"Mutation"/.test(f.payload)) sent[m[1]] = (sent[m[1]] ?? 0) + 1;
  }));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // proxyWs: Convex + SpacetimeDB sockets pass through Playwright so a test can cut them (setOffline doesn't drop open sockets).
  const sockets = [];
  if (proxyWs) await page.routeWebSocket(/convex\.cloud|:3000/, (ws) => { sockets.push([ws, ws.connectToServer()]); });
  const drop = () => { for (const [ws, server] of sockets.splice(0)) { ws.close({ code: 4000, reason: 'test drop' }); server.close(); } };
  await page.goto(`${BASE}/phone`);
  return { ctx, page, sent, drop };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}ph2-${name}.png` });
async function join(page, name) {
  await page.fill('#name', name);
  await page.click('form button');
  await page.waitForSelector('#send');
}
async function ask(question = 'Is the $200,000 additional, or is it the new total?') {
  await cvx.mutation(api.clarifications.resetOpen, {});
  return cvx.mutation(api.clarifications.ask, { workItemId: WI, question, options: ['additional', 'new_total'] });
}
async function hold(page, ms) {
  const b = await page.locator('#talk').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
}
const row = async (id, wi = WI) => (await cvx.query(api.clarifications.byWorkItem, { workItemId: wi })).find((r) => r._id === id);
async function noteTranscripts(page) { transcripts.push(...(await page.evaluate(() => window.__phoneTranscripts ?? []))); }
async function celebrateThenHome(page, name, motion, shotName) {
  await page.waitForSelector('h1.thanks', { timeout: 10_000 });
  await page.waitForTimeout(400); // mid-bounce
  await shot(page, shotName);
  const t = await page.textContent('h1.thanks');
  assert(t.includes(`Thanks, ${name}. Summo is booking it with your name on it.`), `thanks text: ${t}`);
  const anim = await page.evaluate(() => ({ bounce: document.querySelector('.summo').classList.contains('bounce'), glow: document.body.classList.contains('celebrate') }));
  assert(motion ? anim.bounce && anim.glow : !anim.bounce && !anim.glow, `animation classes ${JSON.stringify(anim)} (motion=${motion})`);
  await page.waitForSelector('#send', { timeout: 4000 }); // 2.2 s later: Home
}

async function scenario(key, fn) {
  try { await fn(); results[key] = 'PASS'; } catch (e) { results[key] = `FAIL: ${e.message.split('\n')[0]}`; }
  console.log(key, results[key]);
}

await scenario('a', async () => {
  const { ctx, page } = await phone();
  await join(page, 'Alex');
  await page.fill('#text', 'we need another $200,000 to finish');
  await page.click('#send');
  await page.waitForSelector('h1.q', { timeout: 150_000 }); // the agent asked
  const active = await cvx.query(api.clarifications.active, {});
  assert(await page.locator('.talk.asking').count() === 1, 'mic button should pulse while asking');
  await shot(page, 'a1-ringing');
  await hold(page, 1500);
  await page.waitForSelector('#wait', { timeout: 5000 }).catch(() => {});
  await shot(page, 'a2-sending');
  await page.waitForSelector('[data-opt="additional"]', { timeout: 35_000 }); // transcript (unmatched) or the 12 s timeout
  await page.waitForTimeout(500);
  await noteTranscripts(page);
  await shot(page, 'a3-options');
  await page.click('[data-opt="additional"]');
  await celebrateThenHome(page, 'Alex', true, 'a4-thanks');
  await shot(page, 'a5-home');
  const r = await row(active._id, active.workItemId);
  assert(r.status === 'confirmed' && r.answer === 'additional' && r.speaker === 'Alex', `convex row ${JSON.stringify({ s: r.status, a: r.answer, sp: r.speaker })}`);
  await ctx.close();
});

await scenario('b', async () => {
  const { ctx, page, drop } = await phone({ proxyWs: true });
  await join(page, 'Bea');
  await ask();
  await page.waitForSelector('h1.q', { timeout: 15_000 });
  await page.reload();
  await page.waitForSelector('#talk', { timeout: 15_000 });
  assert((await page.textContent('h1.q')).includes('$200,000'), 'question restored');
  await shot(page, 'b1-ringing-after-reload');
  // connection loss: cut both sockets -> one-line "Reconnecting…", then both clients come back by themselves
  await page.waitForFunction(() => document.getElementById('conn').textContent === 'ledger: online · convex: online', null, { timeout: 15_000 });
  drop();
  await page.waitForFunction(() => document.getElementById('conn').textContent === 'Reconnecting…', null, { timeout: 10_000 });
  await shot(page, 'b2-reconnecting');
  await page.waitForFunction(() => document.getElementById('conn').textContent === 'ledger: online · convex: online', null, { timeout: 40_000 });
  assert(await page.locator('#talk').count() === 1, 'still on Ringing after reconnect');
  results.b_reconnect = 'both sockets cut -> Reconnecting… -> ledger online + convex online, Ringing kept';
  await ctx.close();
});

await scenario('c', async () => {
  const { ctx, page, sent } = await phone();
  await page.fill('#name', 'Cy');
  await page.evaluate(() => { const f = document.getElementById('join'); f.requestSubmit(); f.requestSubmit(); });
  await page.waitForSelector('#send');
  await page.waitForTimeout(800);
  assert(sent['managers:join'] === 1, `join mutations sent: ${sent['managers:join']}`);
  assert((await cvx.query(api.managers.current, {}))?.name === 'Cy', 'current manager is Cy');
  const id = await ask();
  await page.waitForSelector('#tap', { timeout: 15_000 });
  await page.click('#tap');
  await page.waitForSelector('[data-opt="new_total"]');
  await page.evaluate(() => { const b = document.querySelector('[data-opt="new_total"]'); b.click(); b.click(); });
  await page.waitForSelector('h1.thanks', { timeout: 10_000 });
  await page.waitForTimeout(500);
  assert(sent['clarifications:confirm'] === 1, `confirm mutations sent: ${sent['clarifications:confirm']}`);
  const r = await row(id);
  assert(r.status === 'confirmed' && r.answer === 'new_total' && r.speaker === 'Cy', 'confirmed new_total by Cy');
  await shot(page, 'c1-double-tap-confirmed');
  await ctx.close();
});

await scenario('d', async () => {
  const { ctx, page } = await phone();
  await join(page, 'Dee');
  await page.route('**/api/storage/upload**', (r) => r.abort());
  const id = await ask();
  await page.waitForSelector('#talk', { timeout: 15_000 });
  await hold(page, 1500);
  await page.waitForSelector('[data-opt="additional"]', { timeout: 20_000 });
  const t = await page.textContent('#choose');
  assert(t.includes("The recording didn't send. Tap your answer."), `fallback sentence: ${t}`);
  await shot(page, 'd1-upload-failed');
  await page.click('[data-opt="additional"]');
  await celebrateThenHome(page, 'Dee', true, 'd2-thanks');
  const r = await row(id);
  assert(r.status === 'confirmed' && r.answer === 'additional' && r.speaker === 'Dee', 'confirmed after upload failure');
  await ctx.close();
});

await scenario('e', async () => {
  const { ctx, page } = await phone();
  const got = await page.evaluate(async () => {
    const { matchAnswer } = await import('/src/phone.ts');
    const o = ['additional', 'new_total'];
    return ["it's additional", 'the new total', 'additional, not the new total', 'umm I think more on top', 'sure'].map((t) => [t, matchAnswer(t, o)]);
  });
  const want = ['additional', 'new_total', null, 'additional', null];
  got.forEach(([t, m], i) => assert(m === want[i], `matchAnswer("${t}") = ${m}, want ${want[i]}`));
  results.e_detail = JSON.stringify(got);
  await ctx.close();
});

await scenario('f', async () => {
  const { ctx, page } = await phone();
  await join(page, 'Fay');
  const id = await ask();
  await page.waitForSelector('#talk', { timeout: 15_000 });
  await cvx.mutation(api.clarifications.confirm, { id, answer: 'additional', speaker: 'Node script' });
  await page.waitForSelector('#send', { timeout: 10_000 });
  const note = await page.textContent('.note');
  assert(note === STALE, `stale note: ${note}`);
  await shot(page, 'f1-stale');
  await ctx.close();
});

await scenario('g', async () => {
  const { ctx, page } = await phone({ reducedMotion: 'reduce' });
  await join(page, 'Gus');
  const id = await ask();
  await page.waitForSelector('#talk', { timeout: 15_000 });
  assert(await page.locator('.asking, .ring').count() === 0, 'no pulse classes under reduced motion');
  await hold(page, 1500);
  await page.waitForSelector('[data-opt="additional"]', { timeout: 35_000 });
  await noteTranscripts(page);
  await page.click('[data-opt="additional"]');
  await celebrateThenHome(page, 'Gus', false, 'g1-thanks-reduced');
  const r = await row(id);
  assert(r.status === 'confirmed' && r.speaker === 'Gus', 'confirmed under reduced motion');
  await ctx.close();
});

await browser.close();
await cvx.mutation(api.clarifications.resetOpen, {}).catch(() => {});
console.log(JSON.stringify({ results, transcripts, pageErrors }, null, 2));
process.exit(Object.entries(results).some(([k, v]) => k.length === 1 && v !== 'PASS') ? 1 : 0);
