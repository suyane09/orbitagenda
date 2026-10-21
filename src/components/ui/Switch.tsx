interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}

/** Interruptor acessível (role="switch"); `label` vai para leitores de tela. */
export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-orbit' : 'bg-slate/40'}`}>
      <span aria-hidden="true" className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}
