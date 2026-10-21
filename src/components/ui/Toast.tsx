import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

type Tone = 'ok' | 'danger'

/** Aviso temporário (sucesso/erro) anunciado a leitores de tela. Renderize `toast` uma vez na página. */
export function useToast(): { toast: ReactNode; notify: (text: string, tone?: Tone) => void } {
  const [msg, setMsg] = useState<{ text: string; tone: Tone } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const notify = useCallback((text: string, tone: Tone = 'ok') => {
    clearTimeout(timer.current)
    setMsg({ text, tone })
    timer.current = setTimeout(() => setMsg(null), tone === 'ok' ? 4000 : 7000)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const toast = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      {msg && (
        <div className={`pointer-events-auto max-w-md rounded-control px-4 py-3 text-sm font-medium shadow-lg ${msg.tone === 'ok' ? 'bg-ink text-white' : 'bg-danger text-white'}`}>
          {msg.text}
        </div>
      )}
    </div>
  )
  return { toast, notify }
}
