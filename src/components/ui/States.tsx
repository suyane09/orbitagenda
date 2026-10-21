import type { ReactNode } from 'react'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { OrbitMark } from './Logo'

export function FullScreenLoader({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="grid h-full place-items-center bg-paper">
      <div className="flex flex-col items-center gap-4 text-slate">
        <OrbitMark size={40} />
        <div className="flex items-center gap-2 text-sm"><Spinner className="size-4" />{label}</div>
      </div>
    </div>
  )
}

export function ErrorState({ title, message, onRetry, action }: { title: string; message: string; onRetry?: () => void; action?: ReactNode }) {
  return (
    <div className="grid h-full min-h-[60vh] place-items-center bg-paper p-6">
      <div className="max-w-md rounded-panel border border-hairline bg-surface p-8 text-center">
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate">{message}</p>
        <div className="mt-6 flex justify-center gap-3">
          {onRetry && <Button onClick={onRetry}>Tentar novamente</Button>}
          {action}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-control border border-dashed border-hairline px-5 py-8 text-center">
      <p className="font-medium text-graphite">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-slate">{children}</p>
    </div>
  )
}
