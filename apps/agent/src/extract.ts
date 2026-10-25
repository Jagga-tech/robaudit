import { hasKey, prompt, structured } from "./claude.js";
import { Extraction } from "./schemas.js";
import { extractWithGemini } from "./gemini.js";

const SYSTEM = prompt("extract");
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmM]))?(?![A-Za-z\d])`;
const WORD_MULT = /^\s*(million|billion|thousand|mm|bn)\b/i;

// $-anchored figure first; bare number only when the string has no "$". Null if a word multiplier follows ("grand" = k).
// A leading "-" / "minus" (the prompt's reduction marker) makes it negative.
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

// Spoken amounts from a phone answer: "5 million", "four hundred thousand dollars", "400k", "a million", "half a million", "1,000,000".
// The first figure wins and the words after it are ignored ("5 million for 7 months" -> 5,000,000). Null when no figure.
const SMALL: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const BIG: Record<string, number> = { thousand: 1e3, k: 1e3, grand: 1e3, million: 1e6, mil: 1e6, mm: 1e6, m: 1e6, billion: 1e9, bn: 1e9 };
export function parseSpokenCents(text: string): bigint | null {
  const t0 = text.toLowerCase();
  if (/\bpercent\b|%/.test(t0)) return null; // a share of something is not a figure
  const toks = t0.replace(/(\d),(?=\d)/g, '$1').replace(/(\d)([km])\b/g, '$1 $2').split(/[^a-z0-9./]+/).filter(Boolean);
  let total = 0, cur = 0, seen = false, lastBig = 0, prevDigits = false, point = 0;
  for (const t of toks) {
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
    else if ((t === 'to' || t === 'or') && seen) return null; // "2 to 3 million": a range, ask again
    else if (!seen && /^(nothing|none|nil|zero|nada|haven)/.test(t)) { if (!/\d|hundred|thousand|million|billion/.test(t0)) return 0n; } // "nothing yet", "we haven't billed anything"
    else if (seen && t !== 'and' && t !== 'a' && t !== 'of') break;
  }
  return seen ? BigInt(Math.round((total + cur) * 100)) : null;
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
  return mockExtract(noteText);
}

export function mockExtract(noteText: string): Extraction {
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
  const re = noteText.match(/Remaining Estimate:?\s*\$\s?\d[\d,]*(?:\.\d+)?/i);
  if (re) return { facts: [{ kind: "remaining_update", amountText: re[0], quote: re[0], charStart: re.index!, charEnd: re.index! + re[0].length }], ambiguity: none };
  const ms = noteText.match(/\bacceptance\b/i);
  if (ms && /commission|accept(ed|ance) (test|sign)/i.test(noteText)) {
    return { facts: [{ kind: "milestone", amountText: "", quote: ms[0], charStart: ms.index!, charEnd: ms.index! + ms[0].length }], ambiguity: none };
  }
  return { facts: [], ambiguity: none };
}

type Reader = (noteText: string, sourceId: number) => Promise<Extraction>;
export type Both = { claude: Extraction; gemini: Extraction | null; agreed: boolean; merged: Extraction };
const GEMINI_TIMEOUT_MS = 5000;
let warned = false;
const primaryAmount = (x: Extraction) => {
  const f = x.facts.find((f) => f.kind === "remaining_update");
  return f ? parseAmountCents(f.quote) : undefined; // undefined = no fact, null = unparseable
};

// Claude is primary; Gemini is an independent second reader whose failure never blocks the flow.
export async function extractBoth(noteText: string, sourceId: number, readers: { claude: Reader; gemini: Reader } = { claude: extract, gemini: extractWithGemini }): Promise<Both> {
  let timer: NodeJS.Timeout | undefined;
  const second = Promise.race([
    readers.gemini(noteText, sourceId),
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("gemini timeout")), GEMINI_TIMEOUT_MS); }),
  ]).catch((e) => {
    if (!warned && e?.message !== "no GEMINI_API_KEY") { warned = true; console.log("second reader unavailable"); } // no key: gemini.ts already logged
    return null;
  }).finally(() => clearTimeout(timer));
  const [claude, gemini] = await Promise.all([readers.claude(noteText, sourceId), second]);
  if (!gemini) return { claude, gemini, agreed: true, merged: claude };
  const a = primaryAmount(claude), b = primaryAmount(gemini);
  if (a === b) {
    // Same amount: only the flag can differ; the flagged reader's question wins (still an ordinary additive question).
    const merged = !claude.ambiguity.flag && gemini.ambiguity.flag ? { ...claude, ambiguity: gemini.ambiguity } : claude;
    return { claude, gemini, agreed: true, merged };
  }
  const show = (v: bigint | null | undefined, x: Extraction) => v === undefined ? "no remaining-forecast update" : v === null ? `"${x.facts.find((f) => f.kind === "remaining_update")!.quote}"` : `$${v / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const bothAmounts = a != null && b != null;
  const merged: Extraction = { ...claude, ambiguity: {
    flag: true, kind: "other",
    question: `Two independent readers disagree on this note: Claude read ${show(a, claude)}${claude.ambiguity.flag ? " (ambiguous)" : ""}, Gemini read ${show(b, gemini)}${gemini.ambiguity.flag ? " (ambiguous)" : ""}. Which is right?`,
    options: bothAmounts ? ["additional", "new_total"] : claude.ambiguity.options,
  } };
  return { claude, gemini, agreed: false, merged };
}
