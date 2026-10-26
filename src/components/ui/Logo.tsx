/** Símbolo da Orbit Web, sem o nome, utilizado na identidade do OrbitAgenda. */
export function OrbitMark({ size = 32, tone: _tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  return <img src="/orbitweb-mark.svg" width={size} height={size} alt="" aria-hidden="true" className="shrink-0 object-contain" />
}

export function Wordmark({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <span className="inline-flex items-center" aria-label="Orbit Agenda" role="img">
      <OrbitMark size={40} tone={tone} />
    </span>
  )
}
