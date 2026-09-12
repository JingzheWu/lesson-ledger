// Decimal digit arithmetic keeps intermediate products exact on JS engines
// without BigInt (including older iOS mini-program runtimes).
export function multiply(a: string, b: string): string {
  const digits = Array(a.length + b.length).fill(0) as number[]
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) digits[i + j + 1] += Number(a[i]) * Number(b[j])
  }
  for (let i = digits.length - 1; i > 0; i--) {
    digits[i - 1] += Math.floor(digits[i] / 10)
    digits[i] %= 10
  }
  return digits.join('').replace(/^0+(?=\d)/, '')
}

export function roundedFee(hours: number, cents: number, multiplier: number): number {
  const product = multiply(multiply(String(hours), String(cents)), String(multiplier)).padStart(4, '0')
  const whole = Number(product.slice(0, -3))
  const result = whole + (Number(product.slice(-3)) >= 500 ? 1 : 0)
  if (!Number.isSafeInteger(result)) throw new Error('合计数值过大，无法精确计算，请检查输入或单价')
  return result
}
