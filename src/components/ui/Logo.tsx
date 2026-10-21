export function OrbitMark({ size = 32, tone = 'light' }: { size?: number; tone?: 'light' | 'dark' }) {
  const bg = tone === 'light' ? '#11141A' : '#ffffff'
  const fg = tone === 'light' ? '#ffffff' : '#11141A'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill={bg} />
      <ellipse cx="16" cy="16" rx="9.5" ry="5" transform="rotate(-28 16 16)" fill="none" stroke={fg} strokeWidth="1.8" />
      <circle cx="22.2" cy="11.6" r="2.6" fill="#8B8CF5" />
    </svg>
  )
}

export function Wordmark({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <OrbitMark tone={tone} />
      <span className={`font-display text-[1.15rem] font-semibold tracking-tight ${tone === 'light' ? 'text-ink' : 'text-white'}`}>
        Orbit Agenda
      </span>
    </span>
  )
}
