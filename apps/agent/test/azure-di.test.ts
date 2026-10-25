import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAzureDiReal, ocrNote, readForecastDocument } from '../src/azure-di';
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
    expect(JSON.parse(ocr.factsJson)).toEqual(doc);
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

  describe.skipIf(!isAzureDiReal)('real Azure Document Intelligence', () => {
    it('reads $600,000 from the fixture PDF', async () => {
      const d = await readForecastDocument(pdf, 'application/pdf');
      expect(d.text).toContain('600,000');
    }, 60_000);
  });
});
