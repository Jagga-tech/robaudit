// Offline demo backend. Used when the SpacetimeDB/Convex stack is not reachable.
// It mirrors the reducer guards in spacetimedb/src/index.ts and the agent loop in apps/agent/src/loop.ts.
// Arithmetic comes from @keel/engine (the same package the live agent uses). The agent's reading and
// explanation are scripted here; in live mode they come from Claude/Gemini.
import { adjustment, applyUpdate, buildEntry, buildInvoiceEntry, compute, type Snapshot as EngineSnapshot } from '@keel/engine';
import seed from '../../../../demo/seed.json';
import { usd } from '../lib/format';
import {
  EMPTY_SNAPSHOT, ROLE_NAMES, type ClarificationAnswer, type ConnectionState, type KeelBackend, type Proposal,
  type Result, type Role, type Snapshot, type SourceKind, toResult,
} from './model';

const STORE_KEY = 'keel-demo-ledger-v1';
const ROLE_KEY = 'keel-demo-role';
const CHANNEL = 'keel-demo';
const AGENT = 'Keel Agent';
const READ_MS = 1100; // pacing so each agent step is visible; the live agent takes ~2–6 s per Claude read

type Tables = Omit<Snapshot, 'agentBusy'>;
type State = { tables: Tables; nextId: number; agentBusy: boolean };

const DATE_KEYS = new Set(['approvedAt', 'createdAt', 'at', 'postedAt', 'confirmedAt']);
const serialize = (s: State) => JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
const deserialize = (raw: string): State =>
  JSON.parse(raw, (k, v) => {
    if (typeof v === 'string' && /^-?\d+n$/.test(v)) return BigInt(v.slice(0, -1));
    if (DATE_KEYS.has(k) && typeof v === 'string') return new Date(v);
    return v;
  });

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const fail = (code: string, message: string): never => { throw new Error(`${code}: ${message}`); };
const maxBy = <T extends { id: bigint }>(xs: T[]) => xs.reduce<T | undefined>((m, r) => (!m || r.id > m.id ? r : m), undefined);

/** Parse "another $200,000" style amounts the same way the agent's parseAmountCents does (dollar-anchored). */
export function parseAmountCents(text: string): bigint | null {
  const m = text.match(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(k|m)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const mult = m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1;
  return BigInt(Math.round(n * mult * 100));
}

function seedState(): State {
  let id = 0;
  const next = () => BigInt(++id);
  const now = new Date();
  const t: Tables = structuredClone(EMPTY_SNAPSHOT) as Tables;
  const p = { id: next(), name: seed.project.name, contractValueCents: BigInt(seed.project.contractValueCents), periodOpen: seed.project.periodOpen };
  t.projects.push(p);
  t.policies.push({ id: next(), version: seed.policy.version, text: seed.policy.text, approvedBy: seed.policy.approvedBy, approvedAt: now });
  const src: Record<string, bigint> = {};
  const notes: bigint[] = [];
  for (const s of seed.sources) {
    const row = { id: next(), projectId: p.id, kind: s.kind, version: s.version, text: s.text, parentSourceId: 0n, hash: hash(s.text), createdAt: now };
    t.sources.push(row);
    if (s.kind === 'note') notes.push(row.id); else src[s.kind] = row.id;
  }
  t.conventions.push({ id: next(), projectCompanyScope: seed.project.company, ...seed.convention, exampleSourceIds: notes.join(',') });
  t.milestones.push({ id: next(), projectId: p.id, name: seed.milestone.name, amountCents: BigInt(seed.milestone.amountCents), status: seed.milestone.status });
  const w = { id: next(), projectId: p.id, ...seed.workItem };
  t.workItems.push(w);
  const c = seed.calculation;
  const calc = {
    id: next(), workItemId: w.id, forecastSourceId: src.forecast,
    inputsJson: JSON.stringify({
      contractValueCents: String(seed.project.contractValueCents), incurredCents: String(seed.sources[1].incurredCents),
      remainingCents: String(seed.sources[2].remainingCents), billedCents: String(seed.sources[3].billedCents),
    }),
    progressBp: c.progressBp, cumRevenueCents: BigInt(c.cumRevenueCents), contractAssetCents: BigInt(c.contractAssetCents),
    marginCents: BigInt(c.marginCents), lossWarning: c.lossWarning,
  };
  t.calculations.push(calc);
  const pr = seed.proposal;
  const prop = {
    id: next(), workItemId: w.id, calculationId: calc.id, revision: pr.revision, entryJson: JSON.stringify(pr.entry), explanation: pr.explanation,
    evidenceSourceIds: [src.contract, src.cost_export, src.forecast, src.invoice].join(','), pendingConventionJson: '', status: pr.status,
  };
  t.proposals.push(prop);
  t.approvals.push({ id: next(), proposalId: prop.id, revision: pr.revision, decision: 'approve', by: pr.postedBy, reason: 'S0 seed', at: now });
  t.postings.push({ id: next(), proposalId: prop.id, revision: pr.revision, postingRef: pr.postingRef, linesJson: prop.entryJson, postedBy: pr.postedBy, postedAt: now });
  t.history.push({ id: next(), projectId: p.id, kind: 'seed', refId: p.id, summary: 'S0 seeded', actor: 'system', at: now });
  return { tables: t, nextId: id, agentBusy: false };
}

export class DemoBackend implements KeelBackend {
  readonly mode = 'demo' as const;
  private state: State;
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
  private currentRole: Role;
  private timers: number[] = [];

  constructor(private storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    const raw = this.storage?.getItem(STORE_KEY);
    this.state = raw ? deserialize(raw) : seedState();
    this.snapshot = this.freeze();
    this.currentRole = (this.storage?.getItem(ROLE_KEY) as Role) || 'accountant';
    this.channel?.addEventListener('message', () => this.reload());
    if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key === STORE_KEY && this.reload());
  }

  getSnapshot = () => this.snapshot;
  getState = (): ConnectionState => 'ready';
  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  role = () => this.currentRole;

  async setRole(role: Role) {
    this.currentRole = role;
    this.storage?.setItem(ROLE_KEY, role);
    this.emit();
  }

  // ---- reducers (same guards and order as spacetimedb/src/index.ts) ----

  async addSource(kind: SourceKind, text: string, parentSourceId = 0n): Promise<Result> {
    return this.run(() => {
      const project = this.oakland();
      const s = this.insertSource(project.id, kind, text, parentSourceId, ROLE_NAMES[this.currentRole]);
      if (kind === 'note' || kind === 'commissioning_log') {
        this.state.agentBusy = true;
        this.schedule(() => this.agentRead(s.id), READ_MS);
      }
    });
  }

  async decide(p: Proposal, decision: 'approve' | 'return' | 'hold', reason: string): Promise<Result> {
    return this.run(() => {
      this.requireRole('controller');
      const status = ({ approve: 'approved', return: 'returned', hold: 'held' } as const)[decision] ?? fail('bad_input', 'unknown decision');
      const cur = this.currentProposal(p.id, p.revision);
      if (cur.status !== 'open') fail('revision', `proposal ${p.id} already ${cur.status}`);
      cur.status = status;
      const w = this.workItem(cur.workItemId);
      w.status = status;
      const by = ROLE_NAMES.controller;
      this.state.tables.approvals.push({ id: this.id(), proposalId: cur.id, revision: cur.revision, decision, by, reason, at: new Date() });
      this.log(w.projectId, `decision_${decision}`, cur.id, `Rev ${cur.revision} ${status} by ${by}${reason ? ': ' + reason : ''}`, by);
      if (decision === 'approve' && cur.pendingConventionJson) {
        const c = JSON.parse(cur.pendingConventionJson) as { template: string; key: string; value: string };
        const existing = this.state.tables.conventions.find((x) => x.template === c.template && x.key === c.key);
        const row = existing ?? { id: this.id(), projectCompanyScope: seed.project.company, template: c.template, key: c.key, value: c.value, exampleSourceIds: '', policyVersion: 0, approvedBy: by };
        Object.assign(row, { value: c.value, exampleSourceIds: cur.evidenceSourceIds, policyVersion: this.state.tables.policies[0]?.version ?? 0, approvedBy: by });
        if (!existing) this.state.tables.conventions.push(row);
        this.log(w.projectId, 'convention_saved', row.id, `${c.template}.${c.key} = ${c.value}`, by);
      }
    });
  }

  async post(p: Proposal, postingRef: string): Promise<Result> {
    return this.run(() => {
      this.requireRole('controller');
      const p0 = this.state.tables.proposals.find((x) => x.id === p.id) ?? fail('not_approved', `proposal ${p.id} not found`);
      if (p0.status !== 'approved' && p0.status !== 'posted') fail('not_approved', `proposal ${p.id} is ${p0.status}`);
      const cur = this.currentProposal(p.id, p.revision);
      const w = this.workItem(cur.workItemId);
      const proj = this.state.tables.projects.find((x) => x.id === w.projectId) ?? fail('not_found', `project ${w.projectId}`);
      if (!proj.periodOpen) fail('period_closed', `period closed for ${proj.name}`);
      const ls = JSON.parse(cur.entryJson) as { debit: string; credit: string }[];
      let dr = 0n, cr = 0n;
      for (const l of ls) { dr += BigInt(l.debit); cr += BigInt(l.credit); }
      if (ls.length === 0 || dr !== cr) fail('unbalanced', `debits ${dr} != credits ${cr}`);
      const postings = this.state.tables.postings;
      if (postings.some((x) => x.postingRef === postingRef)) fail('duplicate_posting', `postingRef ${postingRef} already posted`);
      const prior = postings.find((x) => x.proposalId === cur.id);
      if (prior) fail('duplicate_posting', `proposal ${cur.id} already posted as ${prior.postingRef}`);
      const by = ROLE_NAMES.controller;
      const pg = { id: this.id(), proposalId: cur.id, revision: cur.revision, postingRef, linesJson: cur.entryJson, postedBy: by, postedAt: new Date() };
      postings.push(pg);
      w.status = 'posted';
      this.log(w.projectId, 'posted', pg.id, `${postingRef} posted (rev ${cur.revision}) by ${by}`, by);
    });
  }

  async reset(): Promise<Result> {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.state = seedState();
    this.log(this.oakland().id, 'reset', 0n, 'Demo reset to S0', ROLE_NAMES[this.currentRole]);
    this.commit();
    return { ok: true };
  }

  // ---- phone (stands in for convex/clarifications.ts) ----

  async startAnswer(callId: string): Promise<Result> {
    return this.run(() => {
      const c = this.call(callId);
      if (c.status === 'ringing') c.status = 'answering';
    });
  }

  async confirm(callId: string, answer: ClarificationAnswer, speaker: string): Promise<Result> {
    return this.run(() => {
      const c = this.call(callId);
      if (c.status === 'confirmed' || c.status === 'unconfirmed') fail('revision', 'clarification already closed');
      Object.assign(c, { status: 'confirmed', answer, speaker, confirmedAt: Date.now() });
      this.state.agentBusy = true;
      this.schedule(() => this.agentResume(callId), READ_MS);
    });
  }

  async decline(callId: string, reason: string): Promise<Result> {
    return this.run(() => {
      const c = this.call(callId);
      if (c.status === 'confirmed' || c.status === 'unconfirmed') fail('revision', 'clarification already closed');
      Object.assign(c, { status: 'unconfirmed', reason });
      const ref = this.state.tables.clarificationRefs.find((r) => r.convexId === callId);
      if (ref) this.log(this.workItem(ref.workItemId).projectId, 'clarification_unconfirmed', ref.id, `Manager could not confirm: ${reason}. Forecast stays on hold.`, ROLE_NAMES.deployment_manager);
    });
  }

  // ---- scripted agent (mirrors apps/agent/src/loop.ts) ----

  private agentRead(sourceId: bigint) {
    this.mutate(() => {
      const t = this.state.tables;
      const src = t.sources.find((s) => s.id === sourceId);
      if (!src) return;
      if (src.kind === 'commissioning_log') return this.milestoneInvoice(src.id);
      const amount = parseAmountCents(src.text);
      const additive = /\banother\b|\bmore\b|\bextra\b|\badditional\b/i.test(src.text);
      const question = `Is the ${amount != null ? usd(amount, { cents: false }) : 'amount'} additional to the current remaining forecast, or the new total remaining?`;
      const facts = amount != null ? [{ kind: 'remaining_update', amountCents: String(amount), quote: src.text }] : [];
      for (const reader of ['claude', 'gemini']) {
        t.extractions.push({ id: this.id(), sourceId: src.id, reader, factsJson: JSON.stringify(facts), ambiguityFlag: additive, ambiguityText: additive ? question : '' });
        this.log(src.projectId, 'extraction', src.id, `${reader} read source ${src.id}${additive ? ': ambiguous wording' : ''}`, AGENT);
      }
      if (amount == null) { this.state.agentBusy = false; return; }
      const conv = t.conventions.find((c) => c.template === 'forecast' && c.key === 'another_means');
      const w = this.revenueWorkItem(src.projectId);
      if (additive && conv) {
        this.log(src.projectId, 'convention_applied', conv.id, `Convention v${conv.policyVersion}: another_means = ${conv.value} applies; no question asked`, AGENT);
        this.schedule(() => this.mutate(() => this.proposeForecast(src.id, amount, conv.value as ClarificationAnswer, '', `Convention v${conv.policyVersion}: another_means = ${conv.value}`)), READ_MS);
        return;
      }
      if (!additive) {
        this.schedule(() => this.mutate(() => this.proposeForecast(src.id, amount, 'new_total', '')), READ_MS);
        return;
      }
      const callId = `demo-call-${src.id}`;
      t.call = { id: callId, workItemId: String(w.id), question, options: ['additional', 'new_total'], status: 'ringing', createdAt: Date.now() };
      t.clarificationRefs.push({ id: this.id(), workItemId: w.id, sourceId: src.id, convexId: callId, question, status: 'open', answer: '', speaker: '', confirmedAt: null, audioStorageId: '' });
      w.status = 'awaiting_clarification';
      this.log(src.projectId, 'clarification_opened', src.id, `Asked ${ROLE_NAMES.deployment_manager}: ${question}`, AGENT);
      this.state.agentBusy = false;
    });
  }

  private agentResume(callId: string) {
    this.mutate(() => {
      const t = this.state.tables;
      const c = t.call?.id === callId ? t.call : null;
      const ref = t.clarificationRefs.find((r) => r.convexId === callId);
      if (!c || !ref || ref.status !== 'open' || !c.answer) { this.state.agentBusy = false; return; }
      const answer = c.answer as ClarificationAnswer;
      const note = t.sources.find((s) => s.id === ref.sourceId)!;
      Object.assign(ref, { status: 'confirmed', answer, speaker: c.speaker ?? '', confirmedAt: new Date() });
      const clarText = `Clarification from ${c.speaker}: Q: ${ref.question} A: ${answer}`;
      const clar = this.insertSource(note.projectId, 'clarification', clarText, note.id, AGENT);
      const w = this.workItem(ref.workItemId);
      w.status = 'open';
      this.log(note.projectId, 'clarification_confirmed', ref.id, `${c.speaker} confirmed: ${answer}`, AGENT);
      const amount = parseAmountCents(note.text)!;
      this.schedule(() => this.mutate(() => this.proposeForecast(note.id, amount, answer, clarText, '', clar.id, JSON.stringify({ template: 'forecast', key: 'another_means', value: answer }))), READ_MS);
    });
  }

  private baseline(projectId: bigint): { workItemId: bigint; snap: EngineSnapshot } {
    const t = this.state.tables;
    const wis = new Set(t.workItems.filter((w) => w.projectId === projectId).map((w) => w.id));
    const calcs = t.calculations.filter((c) => wis.has(c.workItemId));
    const ok = new Set(t.proposals.filter((p) => p.status === 'approved' || p.status === 'posted').map((p) => p.calculationId));
    const c = maxBy(calcs.filter((x) => ok.has(x.id))) ?? calcs.reduce((m, r) => (r.id < m.id ? r : m));
    const i = JSON.parse(c.inputsJson) as Record<string, string>;
    return { workItemId: c.workItemId, snap: { contractValue: BigInt(i.contractValueCents), incurred: BigInt(i.incurredCents), remaining: BigInt(i.remainingCents), billed: BigInt(i.billedCents) } };
  }

  private proposeForecast(noteId: bigint, amount: bigint, convention: ClarificationAnswer, citation: string, conventionLine = '', clarId?: bigint, pendingConventionJson = '') {
    const t = this.state.tables;
    const note = t.sources.find((s) => s.id === noteId)!;
    const { workItemId, snap } = this.baseline(note.projectId);
    const next = { ...snap, remaining: applyUpdate(snap.remaining, amount, convention) };
    const before = compute(snap), after = compute(next);
    const adj = adjustment(before.cumRevenue, after.cumRevenue);
    const calc = {
      id: this.id(), workItemId, forecastSourceId: note.id,
      inputsJson: JSON.stringify({ contractValueCents: String(next.contractValue), incurredCents: String(next.incurred), remainingCents: String(next.remaining), billedCents: String(next.billed) }),
      progressBp: after.progressBp, cumRevenueCents: after.cumRevenue, contractAssetCents: after.contractAsset, marginCents: after.margin.amount, lossWarning: after.margin.lossWarning,
    };
    t.calculations.push(calc);
    this.log(note.projectId, 'calculation', calc.id, `Engine: remaining ${usd(next.remaining, { cents: false })} (${convention}), progress ${after.progressBp} bp, revenue ${usd(after.cumRevenue, { cents: false })}`, AGENT);
    const escalation = after.margin.lossWarning
      ? `ESCALATION: expected margin ${usd(after.margin.amount, { cents: false })} on contract ${usd(next.contractValue, { cents: false })} (estimated total cost ${usd(after.estTotal, { cents: false })}); controller review required.`
      : '';
    const explanation = [
      escalation,
      conventionLine,
      citation,
      `Remaining cost moves from ${usd(snap.remaining, { cents: false })} to ${usd(next.remaining, { cents: false })}, so estimated total cost becomes ${usd(after.estTotal, { cents: false })}.`,
      `Progress falls from ${(before.progressBp / 100).toFixed(2)}% to ${(after.progressBp / 100).toFixed(2)}%, so cumulative revenue moves from ${usd(before.cumRevenue, { cents: false })} to ${usd(after.cumRevenue, { cents: false })}.`,
      `Contract value, cost incurred and billings are unchanged. [Demo agent: scripted wording; arithmetic from @keel/engine]`,
    ].filter(Boolean).join('\n');
    const w = this.workItem(workItemId);
    for (const p of t.proposals) if (p.workItemId === workItemId && p.status === 'open') p.status = 'stale';
    const revision = Math.max(0, ...t.proposals.filter((p) => p.workItemId === workItemId).map((p) => p.revision)) + 1;
    const prop = {
      id: this.id(), workItemId, calculationId: calc.id, revision, entryJson: JSON.stringify(buildEntry(adj), (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
      explanation, evidenceSourceIds: [note.id, ...(clarId ? [clarId] : [])].join(','), pendingConventionJson, status: 'open',
    };
    t.proposals.push(prop);
    w.status = 'proposed';
    this.log(note.projectId, 'proposed', prop.id, `Rev ${revision} proposed: adjustment ${usd(adj, { cents: false, sign: true })}${escalation ? ' (ESCALATION)' : ''}`, AGENT);
    this.state.agentBusy = false;
  }

  private milestoneInvoice(srcId: bigint) {
    const t = this.state.tables;
    const src = t.sources.find((s) => s.id === srcId)!;
    const m = t.milestones.find((x) => x.projectId === src.projectId && x.status === 'pending');
    if (!m) { this.state.agentBusy = false; return; }
    m.status = 'met';
    this.log(src.projectId, 'milestone_met', m.id, `${m.name} met (evidence source ${src.id})`, AGENT);
    const w = { id: this.id(), projectId: src.projectId, title: 'Milestone invoice: acceptance', status: 'open', assignedRole: 'controller' };
    t.workItems.push(w);
    this.log(src.projectId, 'work_item_opened', w.id, w.title, AGENT);
    const prop = {
      id: this.id(), workItemId: w.id, calculationId: 0n, revision: 1,
      entryJson: JSON.stringify(buildInvoiceEntry(m.amountCents), (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
      explanation: `Acceptance milestone met per commissioning log (source ${src.id}). Contract milestone billing of ${usd(m.amountCents, { cents: false })} is now invoiceable: reclassify from contract asset to accounts receivable. Revenue is unchanged.`,
      evidenceSourceIds: String(src.id), pendingConventionJson: '', status: 'open',
    };
    t.proposals.push(prop);
    w.status = 'proposed';
    this.log(src.projectId, 'proposed', prop.id, `Rev 1 proposed: invoice ${usd(m.amountCents, { cents: false })}`, AGENT);
    this.state.agentBusy = false;
  }

  // ---- helpers ----

  private run(f: () => void): Result {
    try {
      this.reloadFromStorage();
      f();
      this.commit();
      return { ok: true };
    } catch (e) {
      this.reloadFromStorage(); // discard partial mutations, like a failed reducer transaction
      this.snapshot = this.freeze();
      return toResult(e);
    }
  }
  private mutate(f: () => void) { this.reloadFromStorage(); f(); this.commit(); }
  private schedule(f: () => void, ms: number) { this.timers.push(window.setTimeout(f, ms)); }
  private reloadFromStorage() { const raw = this.storage?.getItem(STORE_KEY); if (raw) this.state = deserialize(raw); }
  private reload() { this.reloadFromStorage(); this.snapshot = this.freeze(); this.emit(); }
  private commit() {
    this.storage?.setItem(STORE_KEY, serialize(this.state));
    this.snapshot = this.freeze();
    this.channel?.postMessage('changed');
    this.emit();
  }
  private freeze(): Snapshot { return { ...structuredClone(this.state.tables), agentBusy: this.state.agentBusy }; }
  private emit() { this.listeners.forEach((l) => l()); }
  private id() { return BigInt(++this.state.nextId); }
  private oakland() { return this.state.tables.projects.find((p) => p.name === seed.project.name) ?? fail('not_found', 'project'); }
  private workItem(id: bigint) { return this.state.tables.workItems.find((w) => w.id === id) ?? fail('not_found', `work item ${id}`); }
  private revenueWorkItem(projectId: bigint) {
    const calcWis = new Set(this.state.tables.calculations.map((c) => c.workItemId));
    return this.state.tables.workItems.find((w) => w.projectId === projectId && calcWis.has(w.id)) ?? fail('not_found', 'work item');
  }
  private call(id: string) { const c = this.state.tables.call; return c && c.id === id ? c : fail('not_found', `clarification ${id}`); }
  private requireRole(role: Role) { if (this.currentRole !== role) fail('role', `requires ${role}, caller is ${this.currentRole}`); }
  private currentProposal(id: bigint, revision: number) {
    const p = this.state.tables.proposals.find((x) => x.id === id) ?? fail('not_found', `proposal ${id}`);
    const latest = Math.max(...this.state.tables.proposals.filter((x) => x.workItemId === p.workItemId).map((x) => x.revision));
    if (p.revision !== revision || revision !== latest) fail('revision', `proposal ${id} rev ${revision} is not current (latest ${latest})`);
    if (p.status === 'stale') fail('stale', `proposal ${id} is stale`);
    return p;
  }
  private insertSource(projectId: bigint, kind: string, text: string, parentSourceId: bigint, actor: string) {
    const t = this.state.tables;
    const version = kind === 'forecast' ? Math.max(0, ...t.sources.filter((s) => s.kind === kind).map((s) => s.version)) + 1 : 1;
    const s = { id: this.id(), projectId, kind, version, text, parentSourceId, hash: hash(text), createdAt: new Date() };
    t.sources.push(s);
    this.log(projectId, 'source_added', s.id, `${kind} v${version} added`, actor);
    for (const p of t.proposals) {
      if (p.status === 'open' && p.calculationId !== 0n && t.workItems.find((w) => w.id === p.workItemId)?.projectId === projectId) {
        p.status = 'stale';
        const w = this.workItem(p.workItemId);
        w.status = 'stale';
        this.log(projectId, 'proposal_stale', p.id, `Rev ${p.revision} stale: new evidence (source ${s.id})`, actor);
      }
    }
    return s;
  }
  private log(projectId: bigint, kind: string, refId: bigint, summary: string, actor: string) {
    this.state.tables.history.push({ id: this.id(), projectId, kind, refId, summary, actor, at: new Date() });
  }
}
