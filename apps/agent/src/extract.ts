import { hasKey, prompt, structured } from "./claude.js";
import { Extraction } from "./schemas.js";

const SYSTEM = prompt("extract");
const MONEY = /\$?\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM]\b)?/;

export function parseAmountCents(amountText: string): bigint | null {
  const m = amountText.match(MONEY);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as "k" | "m"] ?? 1;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? BigInt(Math.round(n * mult * 100)) : null;
}

export async function extract(noteText: string, sourceId: number): Promise<Extraction> {
  if (hasKey) return structured(Extraction, SYSTEM, `<note source_id="${sourceId}">${noteText}</note>`);
  // ponytail: deterministic mock only knows the demo's "another $X" ambiguity
  const m = noteText.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?\b/);
  if (/\banother\b/i.test(noteText) && m) {
    const charStart = m.index!, charEnd = charStart + m[0].length;
    return {
      facts: [{ kind: "remaining_update", amountText: m[0], quote: noteText, charStart, charEnd }],
      ambiguity: { flag: true, kind: "additional_vs_total", options: ["additional", "new_total"],
        question: `Is "${m[0]}" added to the current remaining forecast, or is it the new total remaining to finish?` },
    };
  }
  return { facts: [], ambiguity: { flag: false, kind: "none", question: "", options: [] } };
}
