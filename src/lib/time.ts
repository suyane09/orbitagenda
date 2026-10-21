/** Utilitários de fuso: "hoje" é sempre o dia do ESTABELECIMENTO, não do navegador. */

function parts(date: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number }
}

function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000
}

/** Início (inclusivo) e fim (exclusivo) do dia atual no fuso informado. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const p = parts(now, timeZone)
  const at = (day: number) => {
    const guess = new Date(Date.UTC(p.year, p.month - 1, day))
    let t = guess.getTime() - offsetMs(guess, timeZone)
    t = guess.getTime() - offsetMs(new Date(t), timeZone) // 2ª passada corrige bordas de DST
    return new Date(t)
  }
  return { start: at(p.day), end: at(p.day + 1) }
}

export function minutesOfDay(date: Date, timeZone: string): number {
  const p = parts(date, timeZone)
  return p.hour * 60 + p.minute
}

export function greeting(now: Date, timeZone: string): string {
  const h = parts(now, timeZone).hour
  if (h < 5) return 'Boa madrugada'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function formatLongDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(now)
}
