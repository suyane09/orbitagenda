import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Wordmark } from '@/components/ui/Logo'

/** Elipses concêntricas: a "órbita" é o motivo central da marca. */
function Orbits() {
  return (
    <svg viewBox="0 0 600 600" className="absolute -right-56 -top-44 w-[46rem] max-w-none text-white" aria-hidden="true" fill="none">
      {[110, 170, 235, 305, 380].map((r, i) => (
        <ellipse key={r} cx="300" cy="300" rx={r} ry={r * 0.42} transform="rotate(-24 300 300)"
          stroke="currentColor" strokeOpacity={0.5 - i * 0.08} strokeWidth="1" />
      ))}
      <g transform="rotate(-24 300 300)"><circle cx={300 + 235 * Math.cos(-0.7)} cy={300 + 235 * 0.42 * Math.sin(-0.7)} r="7" fill="#8B8CF5" /></g>
      <circle cx="300" cy="300" r="5" fill="#fff" />
    </svg>
  )
}

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Wordmark tone="dark" />
        <Orbits />
        <div className="relative max-w-md">
          <p className="font-display text-[2.6rem] font-medium leading-[1.08] tracking-tight">Cada horário no lugar certo.</p>
          <p className="mt-5 max-w-sm text-[0.95rem] leading-relaxed text-white/60">
            Agenda, equipe e clientes da sua barbearia ou salão reunidos em um painel simples de acompanhar.
          </p>
        </div>
      </aside>

      <main className="flex flex-col px-6 py-8 sm:px-12">
        <div className="lg:hidden"><Link to="/entrar" aria-label="Orbit Agenda"><Wordmark /></Link></div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-[1.9rem] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[0.95rem] leading-relaxed text-slate">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-slate">{footer}</div>}
        </div>
      </main>
    </div>
  )
}
