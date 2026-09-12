import { expect, it } from 'vitest'
import { multiply, roundedFee } from './integer'
import { lessons, parsePrice } from './domain'

it('跨运行时十进制运算与独立BigInt参考一致，包括大数及半分边界', () => {
  let seed = 12345
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed }
  for (let i = 0; i < 2000; i++) {
    const h = random(), p = random(), m = [10, 12, 13][i % 3]
    expect(multiply(String(h), String(p))).toBe(String(BigInt(h) * BigInt(p)))
    const expected = (BigInt(h) * BigInt(p) * BigInt(m) + 500n) / 1000n
    if (expected > BigInt(Number.MAX_SAFE_INTEGER)) expect(() => roundedFee(h, p, m)).toThrow()
    else expect(roundedFee(h, p, m)).toBe(Number(expected))
  }
  expect(roundedFee(1, 50, 10)).toBe(1)
  expect(roundedFee(1, 49, 10)).toBe(0)
  expect(lessons(Number.MAX_SAFE_INTEGER)).toBe('45035996273704.955')
  expect(parsePrice('90071992547409.92').error).toBeTruthy()
})
