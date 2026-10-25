import type { Disagreement } from '../explain.js';
import { forecastFigures, ocrNote, type ForecastDoc } from '../azure-di.js';
import { guardedLedger, log, say, type Agent } from '../bus.js';
import type { Deps, SourceRow } from '../loop.js';
import { reconciler } from './reconciler.js';

// The document reader agent: OCR (Azure Document Intelligence) of a scanned forecast. May only write its own extraction row.
const NAME = 'document-reader', MAY = ['recordExtraction'] as const;
type ScannedFacts = ForecastDoc & { incurredCents?: string; remainingCents?: string; disagreement?: Disagreement };

/** OCR a scanned forecast once (the azure-di extraction row is the cache on retry); returns the source with its OCR note as text,
 *  plus the reconciler's incurred disagreement with the ledger. */
async function readScanned(src: SourceRow, deps: Deps): Promise<{ src: SourceRow; disagreement?: Disagreement }> {
  const ledger = guardedLedger(deps.ledger, NAME, MAY);
  const prior = ledger.state().extractions.find((e) => e.sourceId === src.id && e.reader === 'azure-di');
  let facts = prior && (JSON.parse(prior.factsJson) as ScannedFacts);
  if (facts) await say(ledger, NAME, src.projectId, 'skip', 'OCR already on the ledger from an earlier attempt', 'source', src.id);
  else {
    if (!deps.fetchDocument || !deps.readForecastDocument) throw new Error('scanned_forecast needs fetchDocument + readForecastDocument deps');
    const bytes = await deps.fetchDocument(src.text);
    const doc = await deps.readForecastDocument(bytes, 'application/octet-stream');
    const { incurredCents, remainingCents } = forecastFigures(doc);
    await say(ledger, NAME, src.projectId, 'read', `OCR ${bytes.length} bytes, ${doc.tables.length} table(s)`, 'source', src.id);
    const { disagreement, text: ambiguityText } = await reconciler.handlers.reconcile(deps, src, incurredCents);
    facts = { text: doc.text, tables: doc.tables, incurredCents: incurredCents?.toString(), remainingCents: remainingCents?.toString(), disagreement };
    await ledger.recordExtraction({ sourceId: src.id, reader: 'azure-di', factsJson: JSON.stringify(facts), ambiguityFlag: false, ambiguityText });
    log(`source ${src.id}: azure-di read ${bytes.length} bytes, ${doc.tables.length} table(s)${disagreement ? `; ${ambiguityText}` : ''}`);
  }
  return { src: { ...src, text: ocrNote(facts) }, disagreement: facts.disagreement };
}

export const documentReader = { name: NAME, seat: 'document reader (OCR)', may: MAY, handlers: { read: readScanned } } satisfies Agent<unknown>;
