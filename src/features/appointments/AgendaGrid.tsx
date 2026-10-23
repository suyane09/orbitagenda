import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { STATUS_CHIP, STATUS_LABEL, clipToDay, isActive, layoutLanes, minutesToTime, offHours, snapMinutes, timeToMinutes, zoned } from '@/lib/agenda'
import { blockKindLabel, type ScheduleBlock } from '@/lib/schedule'
import type { AgendaOptions, AppointmentRow, AppointmentStatus } from './api'

export const STATUS_DOT: Record<AppointmentStatus, string> = {
  scheduled: 'bg-amber-500', confirmed: 'bg-orbit', completed: 'bg-emerald-600', cancelled: 'bg-slate/60', no_show: 'bg-danger',
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'

// A escala representa horas, não disponibilidade. Blocos vêm só de agendamentos/bloqueios reais; sombreado "fora do expediente"
// vem do expediente cadastrado. A disponibilidade de verdade é sempre conferida no servidor (RPCs + triggers).
const HOUR_H = 72          // 36px por 30 min
const TIME_W = 54
const STEP = 15            // passo do arrastar (igual ao get_available_slots)
const LINE_HOUR = '#e6e9ef'
const LINE_HALF = '#f1f3f6'
const HATCH = 'repeating-linear-gradient(135deg, rgb(99 108 122 / 0.20) 0 5px, rgb(99 108 122 / 0.08) 5px 10px)'

export interface WorkRange { start: number; end: number }

interface Item { a: AppointmentRow; start: number; end: number; dur: number }
interface DragState { id: string; proId: string; start: number; dur: number }
interface SelState { proId: string; a: number; b: number }

export function DayTimeline({ date, today, appointments, professionals, blocks, hours, tz, blockMode, onOpen, onOpenBlock, onCreate, onMove, onBlockRange }: {
  date: string
  today: string
  appointments: AppointmentRow[]
  professionals: AgendaOptions['professionals']
  blocks: ScheduleBlock[]
  /** Expediente do dia por profissional (minutos). null = não carregado (não sombreia nada). */
  hours: Record<string, WorkRange[]> | null
  tz: string
  blockMode: boolean
  onOpen: (a: AppointmentRow) => void
  onOpenBlock: (b: ScheduleBlock) => void
  onCreate: (professionalId: string, time: string) => void
  onMove: (a: AppointmentRow, professionalId: string, startMin: number) => void
  onBlockRange: (professionalId: string, startMin: number, endMin: number) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const suppressClick = useRef(false)
  const lastType = useRef('mouse')
  const [nowMin, setNowMin] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [sel, setSel] = useState<SelState | null>(null)

  useEffect(() => {
    if (date !== today) { setNowMin(null); return }
    const tick = () => setNowMin(timeToMinutes(zoned(new Date().toISOString(), tz).time))
    tick()
    const t = setInterval(tick, 60_000)
    return () => clearInterval(t)
  }, [date, today, tz])

  const items = useMemo<Item[]>(() => appointments.map((a) => {
    const start = timeToMinutes(zoned(a.starts_at, tz).time)
    const dur = Math.max(15, Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000))
    return { a, start, end: Math.min(24 * 60, start + dur), dur }
  }), [appointments, tz])

  const dayBlocks = useMemo(() => blocks.flatMap((b) => {
    const c = clipToDay(b.starts_at, b.ends_at, date, tz)
    return c ? [{ b, ...c }] : []
  }), [blocks, date, tz])

  const allWork = hours ? Object.values(hours).flat() : []
  const minStart = Math.min(items.length ? Math.min(...items.map((i) => i.start)) : 8 * 60, allWork.length ? Math.min(...allWork.map((w) => w.start)) : 8 * 60)
  const maxEnd = Math.max(items.length ? Math.max(...items.map((i) => i.end)) : 19 * 60, allWork.length ? Math.max(...allWork.map((w) => w.end)) : 19 * 60)
  const startHour = Math.max(0, Math.min(8, Math.floor(minStart / 60)))
  const endHour = Math.min(24, Math.max(20, Math.ceil(maxEnd / 60)))
  const height = (endHour - startHour) * HOUR_H
  const hoursList = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const y = (min: number) => ((min - startHour * 60) / 60) * HOUR_H
  const columns = professionals.length ? professionals : [{ id: 'unassigned', name: 'Atendimentos', color: '#3b36d9' }]
  const canInteract = professionals.length > 0

  const geom = useRef({ startHour, endHour, columns })
  geom.current = { startHour, endHour, columns }
  const cb = useRef({ onMove, onBlockRange })
  cb.current = { onMove, onBlockRange }

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const anchor = items.length ? minStart : nowMin ?? startHour * 60
    el.scrollTop = Math.max(0, y(anchor) - HOUR_H)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, items.length])

  const scrollToNow = () => { if (nowMin !== null && scroller.current) scroller.current.scrollTo({ top: Math.max(0, y(nowMin) - 160), behavior: 'smooth' }) }

  // Ponteiro → coluna e minuto da grade.
  function pointAt(clientX: number, clientY: number, fallbackPro: string) {
    const g = geom.current
    let pro = fallbackPro
    for (const c of g.columns) {
      const r = colRefs.current[c.id]?.getBoundingClientRect()
      if (r && clientX >= r.left && clientX < r.right) { pro = c.id; break }
    }
    const r = colRefs.current[pro]?.getBoundingClientRect()
    const minute = r ? g.startHour * 60 + ((clientY - r.top) / HOUR_H) * 60 : g.startHour * 60
    return { pro, minute }
  }
  function autoScroll(clientY: number) {
    const el = scroller.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (clientY < r.top + 70) el.scrollTop -= 14
    else if (clientY > r.bottom - 50) el.scrollTop += 14
  }

  // ---- Arrastar agendamento (mouse: arrasta direto; toque: segurar ~0,4 s) ----
  function startDrag(e: RPointerEvent<HTMLButtonElement>, it: Item) {
    if (e.button !== 0 || !canInteract || !isActive(it.a.status)) return
    lastType.current = e.pointerType
    const touch = e.pointerType !== 'mouse'
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetMin = ((e.clientY - rect.top) / HOUR_H) * 60
    const info = { active: false, moved: false, pro: it.a.professional_id, start: it.start, x0: e.clientX, y0: e.clientY, timer: 0 }
    const publish = () => setDrag({ id: it.a.id, proId: info.pro, start: info.start, dur: it.dur })
    const blockTouchScroll = (ev: TouchEvent) => { if (info.active) ev.preventDefault() }
    const cleanup = () => {
      window.clearTimeout(info.timer)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key)
      window.removeEventListener('touchmove', blockTouchScroll)
      setDrag(null)
    }
    const move = (ev: PointerEvent) => {
      if (!info.active) {
        if (Math.hypot(ev.clientX - info.x0, ev.clientY - info.y0) < (touch ? 10 : 5)) return
        if (touch) { cleanup(); return } // o usuário está rolando a grade
        info.active = true
      }
      info.moved = true
      autoScroll(ev.clientY)
      const p = pointAt(ev.clientX, ev.clientY, info.pro)
      const g = geom.current
      info.pro = p.pro
      info.start = Math.min(g.endHour * 60 - it.dur, Math.max(g.startHour * 60, snapMinutes(p.minute - offsetMin, STEP)))
      publish()
    }
    const up = () => {
      const { moved, pro, start } = info
      cleanup()
      if (!moved) return
      suppressClick.current = true
      setTimeout(() => { suppressClick.current = false }, 0)
      if (pro !== it.a.professional_id || start !== it.start) cb.current.onMove(it.a, pro, start)
    }
    const cancel = () => cleanup()
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup() }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key)
    window.addEventListener('touchmove', blockTouchScroll, { passive: false })
    if (touch) info.timer = window.setTimeout(() => { info.active = true; navigator.vibrate?.(12); publish() }, 380)
  }

  // ---- Selecionar período para bloquear (modo bloqueio) ----
  function startSelect(e: RPointerEvent<HTMLDivElement>, proId: string) {
    if (!blockMode || !canInteract || e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-appt],[data-blk]')) return
    const touch = e.pointerType !== 'mouse'
    const p0 = pointAt(e.clientX, e.clientY, proId)
    const anchor = snapMinutes(p0.minute, STEP, 'floor')
    let cur = anchor
    let moved = false
    const x0 = e.clientX, y0 = e.clientY
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cleanup)
      setSel(null)
    }
    const move = (ev: PointerEvent) => {
      if (touch) { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) cleanup(); return } // rolagem
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4 && !moved) return
      moved = true
      autoScroll(ev.clientY)
      cur = snapMinutes(pointAt(ev.clientX, ev.clientY, proId).minute, STEP, 'floor')
      setSel({ proId, a: anchor, b: cur })
    }
    const up = () => {
      cleanup()
      const g = geom.current
      let a: number, b: number
      if (moved && cur !== anchor) { a = Math.min(anchor, cur); b = Math.max(anchor, cur) + STEP }
      else { a = snapMinutes(anchor, 30, 'floor'); b = a + 30 } // toque simples = faixa de 30 min
      a = Math.max(g.startHour * 60, a); b = Math.min(g.endHour * 60, b)
      if (b > a) cb.current.onBlockRange(proId, a, b)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cleanup)
    setSel({ proId, a: anchor, b: anchor })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} role="region" aria-label="Grade de horários por profissional" tabIndex={0}
        className={`min-h-[26rem] flex-1 select-none overflow-auto overscroll-contain [--col-min:148px] sm:[--col-min:176px] ${drag ? 'cursor-grabbing' : ''}`}>
        <div className="flex flex-col" style={{ minWidth: `calc(${TIME_W}px + ${columns.length} * var(--col-min))`, width: '100%' }}>
          {/* Cabeçalho dos profissionais */}
          <div className="sticky top-0 z-30 flex shrink-0 border-b border-hairline bg-white">
            <div className="sticky left-0 z-10 shrink-0 border-r border-[#eceff3] bg-white" style={{ width: TIME_W }} />
            {columns.map((pro) => {
              const count = appointments.filter((a) => pro.id === 'unassigned' || a.professional_id === pro.id).length
              return (
                <div key={pro.id} className="flex min-w-[var(--col-min)] flex-1 basis-0 items-center gap-2.5 border-l border-[#eceff3] px-3 py-3 [&:nth-child(2)]:border-l-0">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: pro.color }}>{initials(pro.name)}</span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-sm font-semibold">{pro.name}</span>
                    <span className="block text-[11px] text-slate">{count === 0 ? 'Sem atendimentos' : `${count} ${count === 1 ? 'atendimento' : 'atendimentos'}`}</span>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="flex shrink-0 items-start" style={{ height }}>
            {/* Régua de horas */}
            <div className="sticky left-0 z-20 shrink-0 self-stretch border-r border-[#eceff3] bg-white" style={{ width: TIME_W, height }}>
              <div className="relative" style={{ height }}>
                {hoursList.map((h, i) => {
                  const current = nowMin !== null && nowMin >= h * 60 && nowMin < h * 60 + 60
                  return <span key={h} className={`absolute right-2 text-[11px] tabular-nums ${current ? 'font-semibold text-danger' : 'text-slate'}`} style={{ top: i * HOUR_H + (i === 0 ? 4 : -7) }}>{String(h).padStart(2, '0')}:00</span>
                })}
                {nowMin !== null && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
                  <span className="absolute right-1 z-10 -translate-y-1/2 rounded-full bg-danger px-1.5 py-px text-[10px] font-semibold tabular-nums text-white" style={{ top: y(nowMin) }}>{minutesToTime(nowMin)}</span>
                )}
              </div>
            </div>

            {columns.map((pro) => {
              const mine = items.filter((i) => pro.id === 'unassigned' || i.a.professional_id === pro.id)
              const lanes = layoutLanes(mine)
              const off = hours && pro.id !== 'unassigned' ? offHours(hours[pro.id] ?? [], startHour * 60, endHour * 60) : []
              const myBlocks = dayBlocks.filter((d) => d.b.professional_id === null || d.b.professional_id === pro.id)
              const ghost = drag && drag.proId === pro.id ? drag : null
              const selHere = sel && sel.proId === pro.id ? { s: Math.min(sel.a, sel.b), e: Math.max(sel.a, sel.b) + STEP } : null
              return (
                <div key={pro.id} ref={(el) => { colRefs.current[pro.id] = el }} onPointerDown={(e) => startSelect(e, pro.id)}
                  className="relative min-w-[var(--col-min)] flex-1 basis-0 border-l border-[#eceff3] [&:nth-child(2)]:border-l-0"
                  style={{
                    height,
                    backgroundImage: `linear-gradient(${LINE_HOUR} 1px, transparent 1px), linear-gradient(${LINE_HALF} 1px, transparent 1px)`,
                    backgroundSize: `100% ${HOUR_H}px, 100% ${HOUR_H}px`,
                    backgroundPosition: `0 0, 0 ${HOUR_H / 2}px`,
                  }}>
                  {off.map((r) => <div key={r.start} aria-hidden="true" className="pointer-events-none absolute inset-x-0" title="Fora do expediente" style={{ top: y(r.start), height: y(r.end) - y(r.start), backgroundColor: 'rgb(17 20 26 / 0.04)' }} />)}

                  {/* Faixas clicáveis de 30 min */}
                  {hoursList.flatMap((h) => [0, 30].map((m) => {
                    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                    return (
                      <button key={time} type="button" tabIndex={blockMode ? -1 : 0} onClick={() => { if (!blockMode) onCreate(pro.id, time) }}
                        aria-label={`Novo agendamento com ${pro.name} às ${time}`} title={blockMode ? `Bloquear a partir das ${time}` : `Novo agendamento às ${time}`}
                        className={`group absolute inset-x-0 flex items-center justify-center transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-orbit ${blockMode ? 'cursor-crosshair hover:bg-slate/10' : 'hover:bg-orbit-soft/60 focus-visible:bg-orbit-soft'}`}
                        style={{ top: y(h * 60 + m), height: HOUR_H / 2 }}>
                        <span className="pointer-events-none rounded-full bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-orbit opacity-0 shadow-sm ring-1 ring-orbit/15 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{blockMode ? '' : '+ '}{time}</span>
                      </button>
                    )
                  }))}

                  {/* Bloqueios, folgas e férias */}
                  {myBlocks.map(({ b, start, end }) => {
                    const h = ((end - start) / 60) * HOUR_H
                    return (
                      <button key={b.id} type="button" data-blk onClick={() => onOpenBlock(b)}
                        title={`${blockKindLabel(b.kind)}${b.reason ? ` · ${b.reason}` : ''}`}
                        aria-label={`${blockKindLabel(b.kind)} de ${minutesToTime(start)} a ${minutesToTime(Math.min(end, 1439))}${b.reason ? `, ${b.reason}` : ''}`}
                        className="absolute inset-x-0 z-[5] overflow-hidden border-y border-slate/25 px-2 py-1 text-left text-[11px] text-slate transition hover:bg-slate/10"
                        style={{ top: y(start), height: h, backgroundImage: HATCH }}>
                        {h >= 30 && <span className="inline-flex max-w-full items-center gap-1 rounded bg-white/85 px-1.5 py-0.5 font-medium"><span className="truncate">{blockKindLabel(b.kind)}{b.reason ? ` · ${b.reason}` : ''}</span></span>}
                      </button>
                    )
                  })}

                  {nowMin !== null && nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-20 h-px bg-danger/70" style={{ top: y(nowMin) }}>
                      <span className="absolute -left-1 -top-[3px] size-[7px] rounded-full bg-danger" />
                    </div>
                  )}

                  {/* Seleção do modo bloqueio */}
                  {selHere && <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 z-20 rounded-md border border-dashed border-slate bg-slate/15 px-2 py-1 text-[11px] font-medium text-graphite" style={{ top: y(selHere.s), height: y(selHere.e) - y(selHere.s) }}>Bloquear {minutesToTime(selHere.s)}–{minutesToTime(selHere.e)}</div>}

                  {/* Agendamentos */}
                  {mine.map((it, idx) => {
                    const { a } = it
                    const { lane, lanes: n } = lanes[idx]!
                    const h = Math.max(22, (it.dur / 60) * HOUR_H - 3)
                    const time = zoned(a.starts_at, tz).time
                    const range = `${time}–${zoned(a.ends_at, tz).time}`
                    const dead = a.status === 'cancelled'
                    const movable = canInteract && isActive(a.status)
                    return (
                      <button key={a.id} type="button" data-appt onClick={() => { if (!suppressClick.current) onOpen(a) }}
                        onPointerDown={(e) => startDrag(e, it)} onContextMenu={(e) => { if (lastType.current !== 'mouse') e.preventDefault() }}
                        title={`${range} · ${a.customer_name} · ${a.service_name} · ${STATUS_LABEL[a.status]}${movable ? ' · arraste para reagendar' : ''}`}
                        aria-label={`${range}, ${a.customer_name}, ${a.service_name}, ${STATUS_LABEL[a.status]}`}
                        style={{
                          top: y(it.start) + 1.5, height: h,
                          left: `calc(${(lane / n) * 100}% + 3px)`, width: `calc(${100 / n}% - 6px)`,
                          borderLeftColor: a.professional_color,
                          backgroundColor: `color-mix(in srgb, ${a.professional_color} 13%, white)`,
                        }}
                        className={`absolute z-10 overflow-hidden rounded-lg border border-l-[3px] border-black/[0.06] px-2 text-left text-xs leading-tight shadow-[0_1px_2px_rgb(17_20_26/0.06)] transition hover:z-20 hover:shadow-md focus-visible:z-20 ${movable ? 'cursor-grab' : ''} ${h < 44 ? 'py-0.5' : 'py-1.5'} ${dead ? 'opacity-55' : ''} ${drag?.id === a.id ? 'opacity-30' : ''}`}>
                        {h < 44 ? (
                          <span className="flex h-full items-center gap-1.5">
                            <span className="truncate"><span className="font-semibold tabular-nums">{time}</span> <span className={`font-medium ${dead ? 'line-through' : ''}`}>{a.customer_name}</span></span>
                            <span aria-hidden="true" className={`ml-auto size-2 shrink-0 rounded-full ${STATUS_DOT[a.status]}`} />
                          </span>
                        ) : (
                          <>
                            <span className="flex items-center gap-1.5">
                              <span className={`truncate font-semibold ${dead ? 'line-through' : ''}`}>{a.customer_name}</span>
                              {h < 64 && <span aria-hidden="true" className={`ml-auto size-2 shrink-0 rounded-full ${STATUS_DOT[a.status]}`} />}
                            </span>
                            <span className="mt-0.5 block truncate text-graphite/80">{a.service_name}</span>
                            {h >= 64 && (
                              <span className="mt-1 flex items-center gap-1.5">
                                <span className="truncate tabular-nums text-slate">{range}</span>
                                <span className={`ml-auto shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium ${STATUS_CHIP[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                              </span>
                            )}
                          </>
                        )}
                        {h < 64 && <span className="sr-only"> {range}, {STATUS_LABEL[a.status]}</span>}
                      </button>
                    )
                  })}

                  {/* Prévia do arrastar */}
                  {ghost && (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 z-30 rounded-lg border-2 border-dashed border-orbit bg-orbit/10 px-2 py-1 text-xs font-semibold tabular-nums text-orbit"
                      style={{ top: y(ghost.start), height: (ghost.dur / 60) * HOUR_H - 2 }}>{minutesToTime(ghost.start)}–{minutesToTime(Math.min(1439, ghost.start + ghost.dur))}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-hairline bg-[#fafbfe] px-4 py-2 text-[11px] text-slate">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-l-[3px] border-black/10 bg-orbit-soft" />Atendimento</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-slate/30" style={{ backgroundImage: HATCH }} />Bloqueado</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-hairline" style={{ backgroundColor: 'rgb(17 20 26 / 0.06)' }} />Fora do expediente</span>
        <span className="hidden sm:inline">Arraste um atendimento para reagendar · segure e arraste no celular</span>
        {nowMin !== null && <button type="button" onClick={scrollToNow} className="ml-auto rounded-md px-2 py-1 font-medium text-orbit hover:bg-orbit-soft">Ir para agora</button>}
      </div>
    </div>
  )
}
