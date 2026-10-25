import DocumentIntelligence, { getLongRunningPoller, isUnexpected, type AnalyzeOperationOutput } from '@azure-rest/ai-document-intelligence';
import './claude.js'; // side effect: loads the repo .env (never prints values)

export type ForecastDoc = { text: string; tables: string[][][] };
const { AZURE_DI_ENDPOINT: endpoint, AZURE_DI_KEY: key } = process.env;
export const isAzureDiReal = !!(endpoint && key);
if (!isAzureDiReal) console.log('MOCK: azure-di');

const MOCK: ForecastDoc = {
  text: 'Oakland deployment — Forecast v2 — Remaining Estimate: $600,000 — Costs incurred to date: $400,000',
  tables: [[['Line', 'Amount'], ['Costs incurred to date', '$400,000'], ['Remaining Estimate', '$600,000']]],
};

/** Document Intelligence prebuilt-layout: paragraphs as text, tables as rows of cell strings. */
// ponytail: contentType unused; the service sniffs the format from base64Source bytes
export async function readForecastDocument(bytes: Uint8Array, _contentType: string): Promise<ForecastDoc> {
  if (!isAzureDiReal) return MOCK;
  const client = DocumentIntelligence(endpoint!, { key: key! });
  const initial = await client.path('/documentModels/{modelId}:analyze', 'prebuilt-layout').post({
    contentType: 'application/json',
    body: { base64Source: Buffer.from(bytes).toString('base64') },
  });
  if (isUnexpected(initial)) throw new Error(`azure-di analyze: ${initial.body.error?.message ?? initial.status}`);
  const out = (await getLongRunningPoller(client, initial).pollUntilDone()).body as AnalyzeOperationOutput;
  const r = out.analyzeResult;
  if (out.status !== 'succeeded' || !r) throw new Error(`azure-di analyze ${out.status}: ${out.error?.message ?? 'no result'}`);
  const tables = (r.tables ?? []).map((t) => {
    const rows = Array.from({ length: t.rowCount }, () => Array<string>(t.columnCount).fill(''));
    for (const c of t.cells) rows[c.rowIndex][c.columnIndex] = c.content;
    return rows;
  });
  return { text: r.paragraphs?.map((p) => p.content).join('\n') ?? r.content, tables };
}

/** The note-like text the extraction readers see for a scanned forecast. */
export const ocrNote = (d: ForecastDoc) =>
  `Forecast document (OCR): ${d.text} | tables: ${d.tables.flatMap((t) => t.map((row) => row.join(' | '))).join('; ')}`;
