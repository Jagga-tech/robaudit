import { extractWithGemini } from '../gemini.js';
import type { Extraction } from '../schemas.js';
import { guardedLedger, say, type Agent } from '../bus.js';
import type { Deps, SourceRow } from '../loop.js';

// Independent second reader (Gemini). May only write its own extraction row; absent/failed = skip, never a vote.
const NAME = 'reader-gemini', MAY = ['recordExtraction'] as const;

async function record(deps: Deps, src: SourceRow, g: Extraction | null) {
  const ledger = guardedLedger(deps.ledger, NAME, MAY);
  if (!g) return say(ledger, NAME, src.projectId, 'skip', 'second reader off or unavailable; Claude reads alone', 'source', src.id);
  await ledger.recordExtraction({ sourceId: src.id, reader: 'gemini', factsJson: JSON.stringify(g.facts), ambiguityFlag: g.ambiguity.flag, ambiguityText: g.ambiguity.question });
  await say(ledger, NAME, src.projectId, 'read', `${g.facts.length} fact(s)${g.ambiguity.flag ? ', flagged ambiguous' : ''}`, 'source', src.id);
}

export const readerGemini = { name: NAME, seat: 'reader', may: MAY, handlers: { read: extractWithGemini, record } } satisfies Agent<unknown>;
