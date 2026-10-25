import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAzureDiReal, readForecastDocument } from '../src/azure-di';

const dir = new URL('./fixtures/sheets/', import.meta.url);

describe.skipIf(!isAzureDiReal)('azure-di phone-photo OCR', () => {
  for (const k of ['550', '600', '700', '350']) {
    it(`forecast-${k}k.jpg reads Remaining Estimate ${k},000`, async () => {
      const bytes = new Uint8Array(fs.readFileSync(new URL(`forecast-${k}k.jpg`, dir)));
      const t0 = Date.now();
      const d = await readForecastDocument(bytes, 'image/jpeg');
      console.log(`LATENCY forecast-${k}k.jpg ${Date.now() - t0}ms`);
      expect(d.text).toContain(`${k},000`);
    }, 60_000);
  }
});
