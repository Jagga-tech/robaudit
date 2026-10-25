// Frontend view of the ledger. Mirrors the SpacetimeDB tables in packages/bindings
// (same column names; ids and cents stay bigint) with Timestamps converted to Date.

export type Role = 'accountant' | 'deployment_manager' | 'controller';
export const ROLE_NAMES: Record<Role, string> = { accountant: 'Priya', deployment_manager: 'Matt', controller: 'Dana' };
export const ROLE_TITLES: Record<Role, string> = {
  accountant: 'Project accountant',
  deployment_manager: 'Deployment manager',
  controller: 'Controller',
};

export interface Project { id: bigint; name: string; contractValueCents: bigint; periodOpen: boolean }
export interface Policy { id: bigint; version: number; text: string; approvedBy: string; approvedAt: Date }
export interface Convention {
  id: bigint; projectCompanyScope: string; template: string; key: string; value: string;
  exampleSourceIds: string; policyVersion: number; approvedBy: string;
}
export type SourceKind = 'contract' | 'cost_export' | 'forecast' | 'note' | 'clarification' | 'commissioning_log' | 'invoice';
export interface Source {
  id: bigint; projectId: bigint; kind: SourceKind | string; version: number; text: string;
  parentSourceId: bigint; hash: string; createdAt: Date;
}
export interface Extraction { id: bigint; sourceId: bigint; reader: string; factsJson: string; ambiguityFlag: boolean; ambiguityText: string }
export interface ClarificationRef {
  id: bigint; workItemId: bigint; sourceId: bigint; convexId: string; question: string;
  status: 'open' | 'confirmed' | string; answer: string; speaker: string; confirmedAt: Date | null; audioStorageId: string;
}
export type WorkItemStatus = 'open' | 'awaiting_clarification' | 'proposed' | 'approved' | 'returned' | 'held' | 'stale' | 'posted';
export interface WorkItem { id: bigint; projectId: bigint; title: string; status: WorkItemStatus | string; assignedRole: string }
export interface Calculation {
  id: bigint; workItemId: bigint; forecastSourceId: bigint; inputsJson: string; progressBp: number;
  cumRevenueCents: bigint; contractAssetCents: bigint; marginCents: bigint; lossWarning: boolean;
}
export interface Proposal {
  id: bigint; workItemId: bigint; calculationId: bigint; revision: number; entryJson: string; explanation: string;
  evidenceSourceIds: string; pendingConventionJson: string; status: 'open' | 'approved' | 'returned' | 'held' | 'stale' | 'posted' | string;
}
export interface Approval { id: bigint; proposalId: bigint; revision: number; decision: 'approve' | 'return' | 'hold' | string; by: string; reason: string; at: Date }
export interface Posting { id: bigint; proposalId: bigint; revision: number; postingRef: string; linesJson: string; postedBy: string; postedAt: Date }
export interface Milestone { id: bigint; projectId: bigint; name: string; amountCents: bigint; status: string }
export interface HistoryEvent { id: bigint; projectId: bigint; kind: string; refId: bigint; summary: string; actor: string; at: Date }

/** The Convex clarification call the manager's phone sees (convex/clarifications.ts). */
export type CallStatus = 'ringing' | 'answering' | 'fallback_text' | 'confirmed' | 'unconfirmed';
export interface ClarificationCall {
  id: string; workItemId: string; question: string; options: string[]; status: CallStatus;
  answer?: string; speaker?: string; reason?: string; confirmedAt?: number; createdAt: number;
}

export interface Snapshot {
  projects: Project[]; policies: Policy[]; conventions: Convention[]; sources: Source[]; extractions: Extraction[];
  clarificationRefs: ClarificationRef[]; workItems: WorkItem[]; calculations: Calculation[]; proposals: Proposal[];
  approvals: Approval[]; postings: Posting[]; milestones: Milestone[]; history: HistoryEvent[];
  /** Newest clarification call for the phone, including confirmed/unconfirmed ones so the UI can show the outcome. */
  call: ClarificationCall | null;
  /** True while the agent is reading a source (between source_added and its outcome). */
  agentBusy: boolean;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  projects: [], policies: [], conventions: [], sources: [], extractions: [], clarificationRefs: [], workItems: [],
  calculations: [], proposals: [], approvals: [], postings: [], milestones: [], history: [], call: null, agentBusy: false,
};

/** Reducer error codes thrown as SenderError("code: message") by spacetimedb/src/guards.ts. */
export const ERROR_CODES = ['role', 'revision', 'stale', 'period_closed', 'unbalanced', 'duplicate_posting', 'not_approved', 'not_found', 'bad_input'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | 'unknown' | 'unavailable';
export type Result = { ok: true } | { ok: false; code: ErrorCode; message: string };

export type ConnectionState = 'connecting' | 'ready' | 'error';
export type ClarificationAnswer = 'additional' | 'new_total';

export interface KeelBackend {
  readonly mode: 'live' | 'demo';
  getSnapshot(): Snapshot;
  getState(): ConnectionState;
  subscribe(listener: () => void): () => void;
  role(): Role;
  setRole(role: Role): Promise<void>;
  addSource(kind: SourceKind, text: string, parentSourceId?: bigint): Promise<Result>;
  decide(proposal: Proposal, decision: 'approve' | 'return' | 'hold', reason: string): Promise<Result>;
  post(proposal: Proposal, postingRef: string): Promise<Result>;
  reset(): Promise<Result>;
  // Phone (Convex) side.
  startAnswer(callId: string): Promise<Result>;
  confirm(callId: string, answer: ClarificationAnswer, speaker: string): Promise<Result>;
  decline(callId: string, reason: string): Promise<Result>;
}

export function toResult(e: unknown): Result {
  const message = String((e as Error)?.message ?? e);
  const code = ERROR_CODES.find((c) => new RegExp(`\\b${c}:`).test(message)) ?? 'unknown';
  return { ok: false, code, message };
}
