import type { Extraction, Explanation } from './schemas.js';
import type { ExplainInput } from './explain.js';
import type { ForecastDoc } from './azure-di.js';
import type { Review, ReviewInput } from './agents/reviewer.js';

// Structural row types: only the fields the agent reads (real binding rows are supersets).
export type SourceRow = { id: bigint; projectId: bigint; kind: string; text: string };
type ConventionRow = { template: string; key: string; value: string; policyVersion: number };
type WorkItemRow = { id: bigint; projectId: bigint; title: string };
type CalculationRow = { id: bigint; workItemId: bigint; inputsJson: string; forecastSourceId: bigint };
type ExtractionRow = { sourceId: bigint; reader: string; factsJson: string; ambiguityFlag: boolean };
type ProposalRow = { id?: bigint; calculationId: bigint; status: string };
type MilestoneRow = { id: bigint; projectId: bigint; name: string; amountCents: bigint; status: string };
export type ClarificationRefRow = { id: bigint; workItemId: bigint; sourceId: bigint; convexId: string; status: string; answer: string; speaker: string; audioStorageId: string };
export type LedgerState = {
  projects: { id: bigint; contractValueCents: bigint }[];
  sources: (SourceRow & { parentSourceId: bigint })[];
  conventions: ConventionRow[]; workItems: WorkItemRow[]; calculations: CalculationRow[];
  extractions: ExtractionRow[]; milestones: MilestoneRow[]; clarificationRefs: ClarificationRefRow[]; proposals: ProposalRow[];
};

// Reducer calls take the generated bindings' camelCase arg objects, so the real adapter is `conn.reducers`.
export type Ledger = {
  state(): LedgerState;
  onSourceInsert(cb: (s: SourceRow) => void): void;
  recordExtraction(a: { sourceId: bigint; reader: string; factsJson: string; ambiguityFlag: boolean; ambiguityText: string }): Promise<void>;
  openClarification(a: { workItemId: bigint; convexId: string; question: string }): Promise<void>;
  resolveClarification(a: { clarificationId: bigint; answer: string; speaker: string; audioStorageId: string }): Promise<void>;
  recordCalculation(a: { workItemId: bigint; forecastSourceId: bigint; inputsJson: string; progressBp: number; cumRevenueCents: bigint; contractAssetCents: bigint; marginCents: bigint; lossWarning: boolean }): Promise<void>;
  propose(a: { workItemId: bigint; calculationId: bigint; entryJson: string; explanation: string; evidenceSourceIdsCsv: string; pendingConventionJson: string }): Promise<void>;
  openWorkItem(a: { projectId: bigint; title: string; assignedRole: string }): Promise<void>;
  markMilestoneMet(a: { milestoneId: bigint; evidenceSourceId: bigint }): Promise<void>;
  /** agent_event row (one per agent action). Optional so partial test ledgers still work; absent = not logged. */
  logAgentEvent?(a: { projectId: bigint; agent: string; kind: string; summary: string; refTable: string; refId: bigint }): Promise<void>;
};
export type ConvexClarification = { _id: string; status: string; answer?: string; speaker?: string; answerAudioId?: string };
export type Deps = {
  ledger: Ledger;
  convex: { ask(a: { workItemId: string; question: string; options: string[] }): Promise<string>; byWorkItem(workItemId: string): Promise<ConvexClarification[]>; fallbackText(id: string): Promise<unknown> };
  extract(text: string, sourceId: number): Promise<Extraction>;
  /** Two-reader extraction (Claude + Gemini). Absent = `extract` as the only reader. */
  extractBoth?(text: string, sourceId: number): Promise<{ claude: Extraction; gemini: Extraction | null; agreed: boolean; merged: Extraction }>;
  explain(input: ExplainInput): Promise<Explanation>;
  /** scanned_forecast only: bytes of a Convex storage object, and the OCR reader (Azure Document Intelligence). */
  fetchDocument?(storageId: string): Promise<Uint8Array>;
  readForecastDocument?(bytes: Uint8Array, contentType: string): Promise<ForecastDoc>;
  /** Second-model review of a proposal (Gemini). Absent = reviewer off (logged as skip). */
  review?(input: ReviewInput): Promise<Review>;
};

// Facades over the agents (src/agents/*) and the bus (src/bus.ts); the public API tests and main.ts use.
export { log, attempt } from './bus.js';
export { handleNewSource, proposeFromClarification, isAdditiveWording, isReductionWording, start as startLoop } from './agents/summo.js';
export { normalizeAnswer, resumeClarification, pollConfirmed } from './agents/field-liaison.js';
export { templateExplanation, unverifiedFigure, disagreementSentence } from './agents/explainer.js';
export { DISAGREE_THRESHOLD_CENTS } from './agents/reconciler.js';
