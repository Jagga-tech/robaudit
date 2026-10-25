import { hasKey, prompt, structured } from "./claude.js";
import { Explanation } from "./schemas.js";

const SYSTEM = prompt("explain");
type Cents = bigint;
// ponytail: structural copy of @keel/engine compute() output; import it once the engine package lands
export type ComputeOut = { estTotal: Cents; progressBp: bigint | number; cumRevenue: Cents; contractAsset: Cents; margin: { amount: Cents; bp: bigint | number; lossWarning: boolean } };

/** The sheet and the cost export disagree on a figure; we trust the cost export (cents as decimal strings). */
export type Disagreement = { field: 'incurred'; document: string; ledger: string; trusted: 'cost_export'; reason: string };
export type ExplainInput = {
  before: ComputeOut; after: ComputeOut; adjustmentCents: bigint; convention: string; evidence: string[];
  contractValueCents: bigint; incurredCents: bigint; remainingBeforeCents: bigint; remainingAfterCents: bigint;
  disagreement?: Disagreement;
};

export async function explain(input: ExplainInput): Promise<Explanation> {
  if (!hasKey) return { summary: "MOCK: estimate updated.", whyRevenueMoved: "MOCK: progress changed with the new cost estimate.", whatDidNotChange: "MOCK: cash and the customer invoice are unchanged." };
  const json = JSON.stringify(input, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  return structured(Explanation, SYSTEM, `All money values are integer cents; *Bp values are basis points.\n${json}`);
}
