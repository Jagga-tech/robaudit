import { hasKey, prompt, structured } from "./claude.js";
import { Extraction } from "./schemas.js";

const SYSTEM = prompt("extract");
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmM]))?(?![A-Za-z\d])`;
const WORD_MULT = /^\s*(million|billion|thousand|mm|bn)\b/i;

// $-anchored figure first; bare number only when the string has no "$". Null if a word multiplier follows.
export function parseAmountCents(amountText: string): bigint | null {
  const m = amountText.includes("$")
    ? amountText.match(new RegExp(String.raw`\$\s?` + NUM))
    : amountText.match(new RegExp(NUM));
  if (!m || WORD_MULT.test(amountText.slice(m.index! + m[0].length))) return null;
  const mult = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as "k" | "m"] ?? 1;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? BigInt(Math.round(n * mult * 100)) : null;
}

// Real-model offsets are untrusted: recompute from the quote, drop facts whose quote isn't in the note.
export function normalizeFacts(noteText: string, x: Extraction): Extraction {
  const facts = x.facts.flatMap((f) => {
    const charStart = noteText.indexOf(f.quote);
    return charStart < 0 ? [] : [{ ...f, charStart, charEnd: charStart + f.quote.length }];
  });
  return { ...x, facts };
}

export async function extract(noteText: string, sourceId: number): Promise<Extraction> {
  if (hasKey) return normalizeFacts(noteText, await structured(Extraction, SYSTEM, `<note source_id="${sourceId}">${noteText}</note>`));
  // ponytail: deterministic mock only knows the demo's "another $X" ambiguity
  const m = noteText.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/);
  if (/\banother\b/i.test(noteText) && m) {
    const charStart = m.index!, charEnd = charStart + m[0].length;
    return {
      facts: [{ kind: "remaining_update", amountText: m[0], quote: m[0], charStart, charEnd }],
      ambiguity: { flag: true, kind: "additional_vs_total", options: ["additional", "new_total"],
        question: `Is "${m[0]}" added to the current remaining forecast, or is it the new total remaining to finish?` },
    };
  }
  const none = { flag: false, kind: "none" as const, question: "", options: [] };
  const ms = noteText.match(/\bacceptance\b/i);
  if (ms && /commission|accept(ed|ance) (test|sign)/i.test(noteText)) {
    return { facts: [{ kind: "milestone", amountText: "", quote: ms[0], charStart: ms.index!, charEnd: ms.index! + ms[0].length }], ambiguity: none };
  }
  return { facts: [], ambiguity: none };
}
