import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'accent' | 'outline' | 'ghost'
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  full?: boolean
}

const styles: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-graphite',
  accent: 'bg-orbit text-white hover:bg-orbit-deep',
  outline: 'border border-hairline bg-surface text-ink hover:border-slate/50',
  ghost: 'text-slate hover:bg-ink/5 hover:text-ink',
}

export function Button({ variant = 'primary', loading, full, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-control px-5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${full ? 'w-full' : ''} ${styles[variant]} ${className}`}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}
