import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forecastFigures, isAzureDiReal, ocrNote, readForecastDocument } from '../src/azure-di';
import { mockExtract } from '../src/extract';
import { handleNewSource } from '../src/loop';
import { fake } from './fake-deps';

const pdf = new Uint8Array(fs.readFileSync(new URL('./fixtures/forecast-v2.pdf', import.meta.url)));

describe('azure-di', () => {
  it.skipIf(isAzureDiReal)('mock mode returns the canned forecast text', async () => {
    expect(isAzureDiReal).toBe(false);
    const d = await readForecastDocument(pdf, 'application/pdf');
    expect(d.text).toBe('Oakland deployment — Forecast v2 — Remaining Estimate: $600,000 — Costs incurred to date: $400,000');
    expect(d.tables).toHaveLength(1);
  });

  it('scanned_forecast -> azure-di extraction row, Remaining Estimate as new total via convention, 4000 bp proposal', async () => {
    const f = fake({ facts: [], ambiguity: { flag: false, kind: 'none', question: '', options: [] } });
    f.s.conventions.push({ template: 'forecast', key: 'remaining_estimate_means', value: 'future_costs_only', policyVersion: 3 });
    const doc = { text: 'Aster Robotics — Oakland deployment — Forecast v2\nCosts incurred to date: $400,000\nRemaining Estimate: $600,000\nPrepared by: M. Reyes', tables: [] };
    let fetched = '', readBytes = 0;
    f.deps.fetchDocument = async (id) => { fetched = id; return pdf; };
    f.deps.readForecastDocument = async (b) => { readBytes = b.length; return doc; };
    f.deps.extract = async (t) => mockExtract(t);
    const src = f.add('scanned_forecast', 'kg2storage123');
    await handleNewSource(src, f.deps);

    expect(fetched).toBe('kg2storage123');
    expect(readBytes).toBe(pdf.length);
    const [ocr, claude] = f.named('recordExtraction');
    expect(ocr).toMatchObject({ sourceId: src.id, reader: 'azure-di', ambiguityFlag: false });
    expect(JSON.parse(ocr.factsJson)).toEqual({ ...doc, incurredCents: '40000000', remainingCents: '60000000' }); // sheet agrees with the ledger: no disagreement
    expect(ocr.ambiguityText).toBe('');
    expect(claude).toMatchObject({ reader: 'claude', ambiguityFlag: false });
    expect(f.named('ask')).toHaveLength(0);
    const [calc] = f.named('recordCalculation');
    expect(JSON.parse(calc.inputsJson).remainingCents).toBe('60000000');
    expect(calc).toMatchObject({ forecastSourceId: src.id, progressBp: 4000 });
    const [p] = f.named('propose');
    expect(p.evidenceSourceIdsCsv).toBe(String(src.id));
    expect(p.explanation).toContain('remaining_estimate_means = future_costs_only');
    expect(ocrNote(doc)).toContain('Forecast document (OCR): ');
  });

  it('sheet says incurred $420,000, cost export $400,000 -> disagreement recorded, booked on $400,000, remaining $600,000', async () => {
    const f = fake({ facts: [], ambiguity: { flag: false, kind: 'none', question: '', options: [] } });
    f.s.conventions.push({ template: 'forecast', key: 'remaining_estimate_means', value: 'future_costs_only', policyVersion: 3 });
    const doc = { text: 'Aster Robotics — Oakland deployment — Forecast v2\nCosts incurred to date: $420,000\nRemaining Estimate: $600,000\nPrepared by: M. Reyes', tables: [] };
    f.deps.fetchDocument = async () => pdf;
    f.deps.readForecastDocument = async () => doc;
    f.deps.extract = async (t) => mockExtract(t);
    await handleNewSource(f.add('scanned_forecast', 'kg2storage420'), f.deps);

    const [ocr] = f.named('recordExtraction');
    expect(ocr.ambiguityFlag).toBe(false);
    expect(ocr.ambiguityText).toBe('sources disagree: incurred $420,000 on the sheet vs $400,000 in the cost export; trusting the cost export');
    expect(JSON.parse(ocr.factsJson)).toMatchObject({ incurredCents: '42000000', remainingCents: '60000000', disagreement: { field: 'incurred', document: '42000000', ledger: '40000000', trusted: 'cost_export' } });
    const [calc] = f.named('recordCalculation');
    expect(JSON.parse(calc.inputsJson)).toMatchObject({ incurredCents: '40000000', remainingCents: '60000000' });
    expect(calc.progressBp).toBe(4000);
    const [p] = f.named('propose');
    expect(JSON.parse(p.entryJson)).toContainEqual({ account: 'Revenue', debit: '10000000', credit: '0' }); // adjustment -$100,000
    expect(p.explanation).toContain('The sheet shows $420,000 incurred; the cost export, our system of record, shows $400,000, so we booked on $400,000.');
  });

  it('forecastFigures reads paragraph and table forms; no incurred line -> undefined', () => {
    expect(forecastFigures({ text: 'Costs incurred: $1,000', tables: [[['Remaining Estimate', '$2,500']]] })).toEqual({ incurredCents: 100000n, remainingCents: 250000n });
    expect(forecastFigures({ text: 'Incurred to date $3,000', tables: [] }).incurredCents).toBe(300000n);
    expect(forecastFigures({ text: 'Remaining Estimate: $600,000', tables: [] })).toEqual({ incurredCents: undefined, remainingCents: 60000000n });
  });

  describe.skipIf(!isAzureDiReal)('real Azure Document Intelligence', () => {
    it('reads both figures from the disagreeing sheet (forecast-600k-incurred-420k.pdf)', async () => {
      const bytes = new Uint8Array(fs.readFileSync(new URL('./fixtures/sheets/forecast-600k-incurred-420k.pdf', import.meta.url)));
      expect(forecastFigures(await readForecastDocument(bytes, 'application/pdf'))).toEqual({ incurredCents: 42000000n, remainingCents: 60000000n });
    }, 60_000);

    it('reads $600,000 from the fixture PDF', async () => {
      const d = await readForecastDocument(pdf, 'application/pdf');
      expect(d.text).toContain('600,000');
    }, 60_000);
  });
});
