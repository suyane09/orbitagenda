import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const base =
  'w-full rounded-control border bg-surface px-3.5 text-[0.95rem] text-ink placeholder:text-slate/60 transition-colors focus:border-orbit focus:outline-none focus:ring-2 focus:ring-orbit/20'
const control = `h-11 ${base}`

function Shell({ id, label, error, hint, children }: { id: string; label: string; error?: string | undefined; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-graphite">{label}</label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="text-[0.8125rem] text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-[0.8125rem] text-slate">{hint}</p>
      ) : null}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label: string; error?: string | undefined; hint?: string | undefined }
export function TextField({ label, error, hint, className = '', ...rest }: InputProps) {
  const id = useId()
  return (
    <Shell id={id} label={label} error={error} hint={hint}>
      <input id={id} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={`${control} ${error ? 'border-danger' : 'border-hairline'} ${className}`} {...rest} />
    </Shell>
  )
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { label: string; error?: string | undefined; options: readonly { value: string; label: string }[] }
export function SelectField({ label, error, options, className = '', ...rest }: SelectProps) {
  const id = useId()
  return (
    <Shell id={id} label={label} error={error}>
      <select id={id} aria-invalid={!!error} className={`${control} ${error ? 'border-danger' : 'border-hairline'} ${className}`} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Shell>
  )
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { label: string; error?: string | undefined; hint?: string | undefined }
export function TextAreaField({ label, error, hint, className = '', ...rest }: TextAreaProps) {
  const id = useId()
  return (
    <Shell id={id} label={label} error={error} hint={hint}>
      <textarea id={id} rows={3} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={`${base} min-h-24 resize-y py-2.5 ${error ? 'border-danger' : 'border-hairline'} ${className}`} {...rest} />
    </Shell>
  )
}
