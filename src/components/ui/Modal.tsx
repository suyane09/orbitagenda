import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Enquanto ocupado (salvando), Esc e clique no fundo não fecham. */
  busy?: boolean
}

/** Diálogo acessível: foco preso, Esc fecha, rolagem do fundo travada, foco devolvido ao fechar. */
export function Modal({ title, onClose, children, footer, busy = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement as HTMLElement | null
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    ;(root.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0])?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const list = items()
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" tabIndex={-1} aria-label="Fechar" className="absolute inset-0 cursor-default bg-ink/50"
        onClick={() => { if (!busy) onClose() }} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-panel bg-surface shadow-xl sm:max-w-lg sm:rounded-panel">
        <div className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-4">
          <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}
            className="grid size-9 place-items-center rounded-control text-slate hover:bg-ink/5 hover:text-ink disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l10 10M13 3L3 13" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-3 border-t border-hairline px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  )
}
