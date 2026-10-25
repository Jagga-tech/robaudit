export type Cents = bigint
export type Bp = number // 0..10000, display only

export function dollars(n: number | string): Cents {
  const s = typeof n === 'number' ? String(n) : n.replace(/[$,\s]/g, '')
  const neg = s.startsWith('-')
  const [w, f = ''] = s.replace(/^[-+]/, '').split('.')
  const c = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2))
  return neg ? -c : c
}

// round half up (toward +inf on ties); d > 0
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  const q = n / d
  const r = n % d
  if (r === 0n) return q
  const floor = r < 0n ? q - 1n : q
  const rem = n - floor * d
  return rem * 2n >= d ? floor + 1n : floor
}
