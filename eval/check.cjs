// Promptfoo javascript assertion: compares the provider's JSON with vars.expect (expected values from docs/proof.md).
// kind/flag follow apps/agent/test/phrasings.test.ts check(); every other key is an exact match; `question` is a regex.
module.exports = (output, { vars }) => {
  const o = JSON.parse(output), w = vars.expect, bad = [];
  if ('flag' in w) {
    if (o.ambiguity.flag !== w.flag) bad.push(`flag ${o.ambiguity.flag}`);
    if (w.flag && (o.ambiguity.kind !== 'additional_vs_total' || o.ambiguity.options.join() !== 'additional,new_total')) bad.push(`ambiguity ${o.ambiguity.kind} [${o.ambiguity.options}]`);
  }
  if (w.kind) {
    const kinds = o.facts.map((f) => f.kind);
    if (w.kind === 'none') { if (kinds.length) bad.push(`facts [${kinds}]`); }
    else {
      if (w.kind !== 'remaining_update' && kinds.includes('remaining_update')) bad.push('unexpected remaining_update');
      if (!kinds.includes(w.kind)) bad.push(`no ${w.kind} fact [${kinds}]`);
    }
  }
  if (w.reasons) for (const r of w.reasons) if (!o.reasons.includes(r)) bad.push(`no guard rule ${r} [${o.reasons}]`); // expected rules must all fire
  if (w.question && !new RegExp(w.question).test(o.question ?? '')) bad.push(`question "${o.question}" !~ /${w.question}/`);
  for (const [k, v] of Object.entries(w)) {
    if (['flag', 'kind', 'question', 'reasons'].includes(k)) continue;
    if (String(o[k]) !== String(v)) bad.push(`${k} ${o[k]} != ${v}`);
  }
  return { pass: !bad.length, score: bad.length ? 0 : 1, reason: bad.length ? bad.join('; ') : 'all expected values match' };
};
