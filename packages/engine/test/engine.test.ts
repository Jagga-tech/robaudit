import { describe, it, expect } from 'vitest'
import { dollars, compute, adjustment, buildEntry, applyUpdate, progressBp, buildInvoiceEntry } from '../src/index.js'

describe('engine answer key', () => {
  it('dollars parses', () => {
    expect(dollars('1,000,000')).toBe(100000000n)
    expect(dollars('$200,000')).toBe(20000000n)
    expect(dollars('-100000')).toBe(-10000000n)
  })
  const S = { contractValue: 100_000_000n, incurred: 40_000_000n, billed: 30_000_000n }
  const run = (remaining: bigint) => compute({ ...S, remaining })
  const bal = (l: { debit: bigint; credit: bigint }[]) =>
    expect(l.reduce((a, x) => a + x.debit, 0n)).toBe(l.reduce((a, x) => a + x.credit, 0n))
  it('before', () => {
    const r = run(40_000_000n)
    expect(r.estTotal).toBe(80_000_000n)
    expect(r.progressBp).toBe(5000)
    expect(r.cumRevenue).toBe(50_000_000n)
    expect(r.contractAsset).toBe(20_000_000n)
    expect(r.margin).toEqual({ amount: 20_000_000n, bp: 2000, lossWarning: false })
  })
  it('additional', () => {
    const rem = applyUpdate(40_000_000n, 20_000_000n, 'additional')
    expect(rem).toBe(60_000_000n)
    const r = run(rem)
    expect(r.estTotal).toBe(100_000_000n)
    expect(r.progressBp).toBe(4000)
    expect(r.cumRevenue).toBe(40_000_000n)
    expect(r.contractAsset).toBe(10_000_000n)
    expect(r.margin).toEqual({ amount: 0n, bp: 0, lossWarning: true })
    const adj = adjustment(50_000_000n, r.cumRevenue)
    expect(adj).toBe(-10_000_000n)
    bal(buildEntry(adj))
  })
  it('new total', () => {
    const rem = applyUpdate(40_000_000n, 20_000_000n, 'new_total')
    expect(rem).toBe(20_000_000n)
    const r = run(rem)
    expect(r.estTotal).toBe(60_000_000n)
    expect(r.progressBp).toBe(6667)
    expect(r.cumRevenue).toBe(66_666_700n)
    expect(r.contractAsset).toBe(36_666_700n)
    expect(r.margin).toEqual({ amount: 40_000_000n, bp: 4000, lossWarning: false })
    const adj = adjustment(50_000_000n, r.cumRevenue)
    expect(adj).toBe(16_666_700n)
    bal(buildEntry(adj))
  })
  it('month 3', () => {
    const rem = applyUpdate(60_000_000n, 5_000_000n, 'additional')
    expect(rem).toBe(65_000_000n)
    const r = run(rem)
    expect(r.estTotal).toBe(105_000_000n)
    expect(r.progressBp).toBe(3810)
    expect(r.cumRevenue).toBe(38_095_200n)
    expect(r.contractAsset).toBe(8_095_200n)
    expect(r.margin.amount).toBe(-5_000_000n)
    expect(r.margin.lossWarning).toBe(true)
    const adj = adjustment(40_000_000n, r.cumRevenue)
    expect(adj).toBe(-1_904_800n)
    bal(buildEntry(adj))
  })
  it('invoice entry', () => {
    const e = buildInvoiceEntry(20_000_000n)
    expect(e).toEqual([
      { account: 'AccountsReceivable', debit: 20_000_000n, credit: 0n },
      { account: 'ContractAsset', debit: 0n, credit: 20_000_000n },
    ])
    bal(e)
  })
  it('entries balance', () => {
    expect(buildEntry(dollars(-100000))).toEqual([
      { account: 'Revenue', debit: 10_000_000n, credit: 0n },
      { account: 'ContractAsset', debit: 0n, credit: 10_000_000n },
    ])
    const up = buildEntry(dollars(166667))
    expect(up[0]).toEqual({ account: 'ContractAsset', debit: 16_666_700n, credit: 0n })
    expect(up[1]).toEqual({ account: 'Revenue', debit: 0n, credit: 16_666_700n })
    expect(buildEntry(0n)).toEqual([])
  })
  it('zero case', () => {
    expect(compute({ contractValue: 100_000_000n, incurred: 0n, remaining: 0n, billed: 0n }).progressBp).toBe(0)
    expect(progressBp(0n, 0n)).toBe(0)
  })
})
