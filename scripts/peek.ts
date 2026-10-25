// Peek: newest rows on the ledger the env points at. Usage: STDB_URI=... STDB_DB=... pnpm tsx scripts/peek.ts
import { connectAs } from '@keel/ledger-client';
const c = await connectAs('controller'); const d = c.db;
const t = (x: any) => x.toDate?.().toISOString().slice(11, 19) ?? '';
const by = (a: any, b: any) => Number(b.id - a.id);
console.log('projects:', [...d.project.iter()].map((p) => `${p.id}:${p.name}(${p.contractValueCents})`).join(' | '));
console.log('work items:', [...d.workItem.iter()].sort(by).slice(0, 4).map((w) => `${w.id}:${w.title}[${w.status}]`).join(' | '));
console.log('sources:'); for (const s of [...d.source.iter()].sort(by).slice(0, 6)) console.log(' ', s.id, s.kind, t(s.createdAt), JSON.stringify(s.text.slice(0, 90)));
console.log('extractions:'); for (const e of [...d.extraction.iter()].sort(by).slice(0, 4)) console.log(' ', e.id, 'src', e.sourceId, e.reader, 'amb', e.ambiguityFlag, e.factsJson.slice(0, 120));
console.log('clarifications:'); for (const q of [...d.clarificationRef.iter()].sort(by).slice(0, 3)) console.log(' ', q.id, 'wi', q.workItemId, q.status, JSON.stringify(q.question.slice(0, 80)));
console.log('calcs:'); for (const k of [...d.calculation.iter()].sort(by).slice(0, 3)) console.log(' ', k.id, 'wi', k.workItemId, k.progressBp, 'bp rev', k.cumRevenueCents);
console.log('proposals:'); for (const p of [...d.proposal.iter()].sort(by).slice(0, 3)) console.log(' ', p.id, 'wi', p.workItemId, 'rev', p.revision, p.status, p.entryJson.slice(0, 100));
console.log('history:'); for (const h of [...d.historyEvent.iter()].sort(by).slice(0, 8)) console.log(' ', t(h.at), h.kind, h.summary.slice(0, 100));
c.disconnect(); process.exit(0);
