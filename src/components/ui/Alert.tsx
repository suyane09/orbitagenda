import type { ReactNode } from 'react'

export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'ok' | 'info'; children: ReactNode }) {
  const t = { danger: 'bg-danger-soft text-danger', ok: 'bg-ok-soft text-ok', info: 'bg-orbit-soft text-orbit-deep' }[tone]
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-control px-4 py-3 text-sm leading-relaxed ${t}`}>{children}</div>
}
