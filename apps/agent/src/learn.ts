import { hasKey, prompt, structured } from "./claude.js";
import { Conventions } from "./schemas.js";

const SYSTEM = prompt("learn");

export async function learnConventions(closes: { sourceId: number; text: string }[]): Promise<Conventions> {
  if (!hasKey) return { proposals: [{ template: "forecast", key: "remaining_estimate_means", value: "MOCK: future_costs_only", rationale: "MOCK: canned convention", exampleSourceIds: closes.map((c) => c.sourceId) }] };
  return structured(Conventions, SYSTEM, closes.map((c) => `<close source_id="${c.sourceId}">\n${c.text}\n</close>`).join("\n"));
}
