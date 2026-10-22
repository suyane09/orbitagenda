import { minutesOfDay } from '@/lib/time'
import type { TodayAppointment } from '@/types/models'

const C = 180, R = 128, W = 12

function point(minutes: number, r = R) {
  const a = (minutes / 1440) * Math.PI * 2 - Math.PI / 2
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) }
}

function arc(from: number, to: number) {
  const span = Math.max(to - from, 18) // arcos curtos continuam visíveis
  const a = point(from), b = point(Math.min(from + span, 1439.9))
  return `M ${a.x} ${a.y} A ${R} ${R} 0 ${span > 720 ? 1 : 0} 1 ${b.x} ${b.y}`
}

const hm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d)

/** O dia do estabelecimento como uma órbita: atendimentos são arcos, "agora" é o ponto. */
export function DayOrbit({ appointments, timezone, now }: { appointments: TodayAppointment[]; timezone: string; now: Date }) {
  const nowMin = minutesOfDay(now, timezone)
  const dot = point(nowMin)
  const next = appointments.find((a) => new Date(a.starts_at) > now)
  const label = appointments.length === 1 ? 'atendimento hoje' : 'atendimentos hoje'

  return (
    <div className="@container relative mx-auto aspect-square w-full max-w-[22rem]">
      <svg viewBox="0 0 360 360" className="size-full" role="img"
        aria-label={`Linha do dia: ${appointments.length} ${label}. Agora são ${hm(now, timezone)}.`}>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--color-hairline)" strokeWidth={W} />
        {[0, 360, 720, 1080].map((m) => {
          const o = point(m, R + 22)
          return <text key={m} x={o.x} y={o.y} textAnchor="middle" dominantBaseline="central" className="fill-slate text-[14px] font-medium">{String(m / 60).padStart(2, '0')}h</text>
        })}
        {appointments.map((a) => {
          const s = minutesOfDay(new Date(a.starts_at), timezone)
          const e = minutesOfDay(new Date(a.ends_at), timezone)
          return <path key={a.id} d={arc(s, e > s ? e : s + 30)} fill="none" stroke="var(--color-orbit)" strokeWidth={W} strokeLinecap="round" />
        })}
        <circle cx={dot.x} cy={dot.y} r="13" fill="var(--color-orbit-glow)" fillOpacity=".25" />
        <circle cx={dot.x} cy={dot.y} r="7" fill="#fff" stroke="var(--color-ink)" strokeWidth="2.5" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-[18cqw] text-center">
        <span className="font-display text-[22cqw] font-semibold leading-none tracking-tight">{appointments.length}</span>
        <span className="mt-[2cqw] text-[6cqw] leading-tight text-slate">{label}</span>
        <span className="mt-[2.5cqw] text-[5.2cqw] leading-snug text-slate">
          {next ? `Próximo às ${hm(new Date(next.starts_at), timezone)}` : appointments.length ? 'Sem mais horários hoje' : 'Agenda livre por enquanto'}
        </span>
      </div>
    </div>
  )
}