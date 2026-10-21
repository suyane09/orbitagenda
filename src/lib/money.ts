/** Valores monetários trafegam SEMPRE como inteiros em centavos (sem float). */

/** Aceita "45", "45,5", "45,50", "1.234,56", "R$ 45,00" e "45.50". Devolve centavos ou null. */
export function parseBRL(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!s) return null
  let intPart: string
  let frac = ''
  if (s.includes(',')) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(s)) return null
    const [i = '', f = ''] = s.split(',')
    intPart = i.replace(/\./g, '')
    frac = f
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const [i = '', f = ''] = s.split('.')
    intPart = i
    frac = f
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    intPart = s.replace(/\./g, '')
  } else if (/^\d+$/.test(s)) {
    intPart = s
  } else {
    return null
  }
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatBRL = (cents: number): string => brl.format(cents / 100)

/** Valor para preencher um campo de edição (sem símbolo): 4500 → "45,00". */
export const centsToInput = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',')

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}
