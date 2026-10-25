export type Line = { account: 'Revenue' | 'ContractAsset' | 'AccountsReceivable'; debit: bigint; credit: bigint };

const abs = (c: bigint) => (c < 0n ? -c : c);

/** Cents → "$1,000,000.00". `sign` prefixes + for positives (used for adjustments). */
export function usd(c: bigint, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const { cents = true, sign = false } = opts;
  const a = abs(c);
  const whole = (a / 100n).toLocaleString('en-US');
  const frac = String(a % 100n).padStart(2, '0');
  const prefix = c < 0n ? '−' : sign && c > 0n ? '+' : '';
  return `${prefix}$${whole}${cents ? '.' + frac : ''}`;
}

/** Cents → "$1.0M" / "$400K" for compact axis labels. */
export function usdShort(c: bigint): string {
  const d = Number(c) / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 1 : 2)}M`;
  if (Math.abs(d) >= 1_000) return `$${Math.round(d / 1_000)}K`;
  return `$${d}`;
}

/** Cents → "1,000,000.00" for ledger columns. */
export const amount = (c: bigint) => usd(c).replace(/^[−+]?\$/, '');

/** Basis points → "40.00%". */
export const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;

export const lines = (entryJson: string): Line[] =>
  entryJson ? (JSON.parse(entryJson) as { account: Line['account']; debit: string; credit: string }[]).map((l) => ({ ...l, debit: BigInt(l.debit), credit: BigInt(l.credit) })) : [];

export const ids = (csv: string) => csv.split(',').filter(Boolean).map((s) => BigInt(s));

export const ACCOUNT_LABEL: Record<Line['account'], { code: string; name: string }> = {
  Revenue: { code: '4010', name: 'Project revenue' },
  ContractAsset: { code: '1250', name: 'Contract asset' },
  AccountsReceivable: { code: '1200', name: 'Accounts receivable' },
};

export const time = (d: Date | null | undefined) =>
  d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';

export const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
export const parseJson = <T,>(s: string): T =>
  JSON.parse(s, (_k, x) => (typeof x === 'string' && /^-?\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x));
