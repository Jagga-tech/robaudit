import { Bp, Cents, divRoundHalfUp } from './money.js'

export function progressBp(incurred: Cents, remaining: Cents): Bp {
  const total = incurred + remaining
  return total === 0n ? 0 : Number(divRoundHalfUp(incurred * 10000n, total))
}

export function cumulativeRevenue(contractValue: Cents, incurred: Cents, estTotal: Cents): Cents {
  if (estTotal === 0n) return 0n
  return divRoundHalfUp(contractValue * incurred, estTotal * 100n) * 100n
}

export const contractAsset = (cumRevenue: Cents, billed: Cents): Cents => cumRevenue - billed

export function expectedMargin(contractValue: Cents, estTotal: Cents) {
  const amount = contractValue - estTotal
  const bp: Bp = contractValue === 0n ? 0 : Number(divRoundHalfUp(amount * 10000n, contractValue))
  return { amount, bp, lossWarning: amount <= 0n }
}

export const adjustment = (prev: Cents, next: Cents): Cents => next - prev

export type EntryLine = { account: 'Revenue' | 'ContractAsset' | 'AccountsReceivable'; debit: Cents; credit: Cents }

export const buildInvoiceEntry = (amount: Cents): EntryLine[] => [
  { account: 'AccountsReceivable', debit: amount, credit: 0n },
  { account: 'ContractAsset', debit: 0n, credit: amount },
]

export function buildEntry(adj: Cents): EntryLine[] {
  if (adj === 0n) return []
  const a = adj < 0n ? -adj : adj
  return adj < 0n
    ? [{ account: 'Revenue', debit: a, credit: 0n }, { account: 'ContractAsset', debit: 0n, credit: a }]
    : [{ account: 'ContractAsset', debit: a, credit: 0n }, { account: 'Revenue', debit: 0n, credit: a }]
}

export type Convention = 'additional' | 'new_total'
export const applyUpdate = (remaining: Cents, update: Cents, c: Convention): Cents =>
  c === 'additional' ? remaining + update : update

export type Snapshot = { contractValue: Cents; incurred: Cents; remaining: Cents; billed: Cents }
export function compute(s: Snapshot) {
  const estTotal = s.incurred + s.remaining
  const cumRevenue = cumulativeRevenue(s.contractValue, s.incurred, estTotal)
  return {
    estTotal,
    progressBp: progressBp(s.incurred, s.remaining),
    cumRevenue,
    contractAsset: contractAsset(cumRevenue, s.billed),
    margin: expectedMargin(s.contractValue, estTotal),
  }
}
