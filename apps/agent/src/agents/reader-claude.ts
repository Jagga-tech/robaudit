import { extract } from '../extract.js';
import type { Extraction } from '../schemas.js';
import { guardedLedger, say, type Agent } from '../bus.js';
import type { Deps, SourceRow } from '../loop.js';

// Primary reader (Claude). May only write its own extraction row; the flag/text it records are summo's decision.
const NAME = 'reader-claude', MAY = ['recordExtraction'] as const;
export const READER = 'claude';

async function record(deps: Deps, src: SourceRow, x: Extraction, ambiguityFlag: boolean, ambiguityText: string) {
  const ledger = guardedLedger(deps.ledger, NAME, MAY);
  await ledger.recordExtraction({ sourceId: src.id, reader: READER, factsJson: JSON.stringify(x.facts), ambiguityFlag, ambiguityText });
  await say(ledger, NAME, src.projectId, 'read', `${x.facts.length} fact(s)${x.ambiguity.flag ? ', flagged ambiguous' : ''}`, 'source', src.id);
}

export const readerClaude = { name: NAME, seat: 'reader', may: MAY, handlers: { read: extract, record } } satisfies Agent<unknown>;
