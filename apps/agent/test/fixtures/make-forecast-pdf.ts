// Writes forecast-v2.pdf next to this file (default), or a numbered sheet: npx tsx make-forecast-pdf.ts <remaining> <sheetNo> <outfile> [incurred=400000]
// e.g. npx tsx make-forecast-pdf.ts 550000 1 sheets/forecast-550k.pdf
//      npx tsx make-forecast-pdf.ts 600000 5 sheets/forecast-600k-incurred-420k.pdf 420000  (sheet disagrees with the cost export)
import fs from 'node:fs';

const [remArg = '600000', sheetNo, out = './forecast-v2.pdf', incArg = '400000'] = process.argv.slice(2);
const rem = Number(remArg).toLocaleString('en-US');
const lines = ['Aster Robotics \\227 Oakland deployment \\227 Forecast v2', `Costs incurred to date: $${Number(incArg).toLocaleString('en-US')}`, `Remaining Estimate: $${rem}`, 'Prepared by: M. Reyes'];
// \227 = em dash in WinAnsiEncoding (PDF string octal escape)
const stream = `BT /F1 18 Tf 72 720 Td (${lines[0]}) Tj /F1 12 Tf ${lines.slice(1).map((l) => `0 -28 Td (${l}) Tj`).join(' ')} ET${sheetNo ? ` BT /F1 120 Tf 480 660 Td (${sheetNo}) Tj ET` : ''}`;
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
];
let pdf = '%PDF-1.4\n';
const offsets = objs.map((o, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(new URL(out, import.meta.url), pdf, 'latin1');
