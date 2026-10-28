import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/errors'
import { fieldErrors, PROFESSIONAL_COLORS, professionalSchema } from '@/lib/validation'
import { useAccount } from '@/features/establishments/AccountProvider'
import type { Professional } from '@/types/models'
import { CommissionSettingsModal } from '@/features/commissions/CommissionSettingsModal'
import { loadCommissionSettings, type CommissionSettings } from '@/features/commissions/api'
import { deleteProfessional, loadProfessionals, saveProfessional, setProfessionalActive, type ProfessionalsData } from './api'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
const COLOR_NAMES: Record<string, string> = {
  '#3B36D9': 'Índigo', '#1B7F55': 'Verde', '#B92D33': 'Vermelho', '#9A5B00': 'Âmbar',
  '#0F7490': 'Azul-petróleo', '#8A3FC4': 'Roxo', '#C2410C': 'Laranja', '#475569': 'Grafite',
}

function ProfessionalForm({ professional, services, establishmentId, onClose, onSaved }: {
  professional: Professional | null
  services: ProfessionalsData['services']
  establishmentId: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [name, setName] = useState(professional?.name ?? '')
  const [bio, setBio] = useState(professional?.bio ?? '')
  const [color, setColor] = useState(professional?.color ?? PROFESSIONAL_COLORS[0])
  const [isActive, setIsActive] = useState(professional?.is_active ?? true)
  const [serviceIds, setServiceIds] = useState<string[]>(professional?.serviceIds ?? [])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const toggleService = (id: string) =>
    setServiceIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const parsed = professionalSchema.safeParse({ name, bio, color, isActive, serviceIds })
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return }
    setErrors({})
    const v = parsed.data
    setSaving(true)
    try {
      await saveProfessional(establishmentId, {
        id: professional?.id ?? null, name: v.name, bio: v.bio || null, color: v.color, is_active: v.isActive, serviceIds: v.serviceIds,
      })
      onSaved(professional ? 'Profissional atualizado.' : 'Profissional criado.')
    } catch (err) {
      setFormError(describeError(err, 'Não foi possível salvar o profissional.'))
      setSaving(false)
    }
  }

  return (
    <Modal title={professional ? 'Editar profissional' : 'Novo profissional'} onClose={onClose} busy={saving}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button type="submit" form="professional-form" variant="accent" loading={saving}>{professional ? 'Salvar alterações' : 'Criar profissional'}</Button>
      </>}>
      <form id="professional-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Nome" data-autofocus value={name} maxLength={80} error={errors.name}
          onChange={(e) => setName(e.target.value)} placeholder="Ex.: João Silva" />
        <TextAreaField label="Apresentação (opcional)" value={bio} maxLength={500} error={errors.bio}
          onChange={(e) => setBio(e.target.value)} />

        <fieldset>
          <legend className="text-sm font-medium text-graphite">Cor na agenda</legend>
          <div role="radiogroup" aria-label="Cor na agenda" className="mt-2 flex flex-wrap gap-2.5">
            {PROFESSIONAL_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={COLOR_NAMES[c] ?? c}
                title={COLOR_NAMES[c]} onClick={() => setColor(c)} style={{ backgroundColor: c }}
                className={`grid size-9 place-items-center rounded-full text-white ring-offset-2 transition ${color === c ? 'ring-2 ring-ink' : 'hover:scale-105'}`}>
                {color === c && <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" /></svg>}
              </button>
            ))}
          </div>
          {errors.color && <p role="alert" className="mt-1.5 text-[0.8125rem] text-danger">{errors.color}</p>}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-graphite">Serviços que realiza</legend>
          {services.length === 0 ? (
            <div className="mt-2"><Alert tone="info">Nenhum serviço cadastrado ainda. <Link to="/app/servicos" className="font-medium underline">Cadastre serviços</Link> e volte para vinculá-los.</Alert></div>
          ) : (
            <ul className="mt-2 max-h-52 divide-y divide-hairline overflow-y-auto rounded-control border border-hairline">
              {services.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 hover:bg-paper">
                    <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggleService(s.id)}
                      className="size-4 accent-orbit" />
                    <span className="text-[0.95rem]">{s.name}{!s.is_active && <span className="ml-2 text-xs text-slate">(inativo)</span>}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {errors.serviceIds && <p role="alert" className="mt-1.5 text-[0.8125rem] text-danger">{errors.serviceIds}</p>}
        </fieldset>

        <div className="flex items-center justify-between gap-4 rounded-control border border-hairline px-4 py-3">
          <div>
            <p className="text-sm font-medium text-graphite">Profissional ativo</p>
            <p className="text-[0.8125rem] text-slate">Inativos ficam guardados, mas fora de uso.</p>
          </div>
          <Switch checked={isActive} onChange={setIsActive} label="Profissional ativo" />
        </div>
      </form>
    </Modal>
  )
}

export default function ProfessionalsPage() {
  const { current } = useAccount()
  const est = current!.establishment
  const isOwner = current!.role === 'owner'
  const { toast, notify } = useToast()

  const [data, setData] = useState<ProfessionalsData | null>(null)
  const [commissions, setCommissions] = useState<CommissionSettings[]>([])
  const [commissionError, setCommissionError] = useState('')
  const [commissionEditing, setCommissionEditing] = useState<Professional | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<Professional | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Professional | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setData(await loadProfessionals(est.id)) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar os profissionais.')) }
  }, [est.id])

  useEffect(() => { setData(null); void load() }, [load])
  const loadCommissions = useCallback(async () => {
    if (!isOwner) return
    try { setCommissions(await loadCommissionSettings(est.id)); setCommissionError('') }
    catch (err) { setCommissionError(describeError(err, 'Não foi possível carregar as comissões.')) }
  }, [est.id, isOwner])
  useEffect(() => { setCommissions([]); void loadCommissions() }, [loadCommissions])
  const commissionById = useMemo(() => new Map(commissions.map((c) => [c.professional_id, c])), [commissions])
  const commissionLabel = (id: string) => {
    const c = commissionById.get(id)
    if (!c || c.mode === 'none') return 'Sem comissão'
    if (c.mode === 'percentage') return `${(c.rate_basis_points / 100).toLocaleString('pt-BR')}% por atendimento`
    return `${(c.fixed_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por atendimento`
  }

  const serviceName = useMemo(() => new Map((data?.services ?? []).map((s) => [s.id, s.name])), [data])

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt-BR')
    return (data?.professionals ?? []).filter((p) =>
      (status === 'all' || (status === 'active') === p.is_active) && (!q || p.name.toLocaleLowerCase('pt-BR').includes(q)))
  }, [data, query, status])

  async function toggle(p: Professional, next: boolean) {
    setTogglingId(p.id)
    try {
      await setProfessionalActive(p.id, est.id, next)
      notify(next ? 'Profissional ativado.' : 'Profissional desativado.')
      await load()
    } catch (e) { notify(describeError(e, 'Não foi possível alterar o status.'), 'danger') }
    finally { setTogglingId(null) }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await deleteProfessional(deleting.id, est.id)
      setDeleting(null)
      notify('Profissional excluído.')
      await load()
    } catch (e) { setDeleteError(describeError(e, 'Não foi possível excluir o profissional.')) }
    finally { setDeleteBusy(false) }
  }

  if (error) return <ErrorState title="Profissionais indisponíveis" message={error} onRetry={() => void load()} />

  const total = data?.professionals.length ?? 0
  const filtering = query.trim() !== '' || status !== 'all'

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">Profissionais</h1>
          <p className="mt-1.5 text-slate">Quem atende em {est.name} e quais serviços cada um realiza.</p>
        </div>
        {isOwner && <Button variant="accent" onClick={() => setEditing('new')}>Novo profissional</Button>}
      </header>

      {isOwner && commissionError && <div className="mt-6"><Alert>{commissionError}</Alert></div>}
      {!isOwner && <div className="mt-6"><Alert tone="info">Somente proprietários criam e editam profissionais. Você pode consultar a lista.</Alert></div>}

      {!data ? (
        <div className="mt-16 flex items-center justify-center gap-3 text-slate"><Spinner />Carregando profissionais…</div>
      ) : total === 0 ? (
        <div className="mt-10">
          <EmptyState title="Nenhum profissional cadastrado">
            {isOwner ? 'Cadastre quem atende no estabelecimento e vincule os serviços que cada um realiza.' : 'O proprietário ainda não cadastrou profissionais.'}
          </EmptyState>
          {isOwner && <div className="mt-5 flex justify-center"><Button variant="accent" onClick={() => setEditing('new')}>Cadastrar primeiro profissional</Button></div>}
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <input type="search" aria-label="Buscar profissional" placeholder="Buscar por nome" value={query} onChange={(e) => setQuery(e.target.value)}
              className="h-11 w-full rounded-control border border-hairline bg-surface px-3.5 text-[0.95rem] placeholder:text-slate/60 focus:border-orbit focus:outline-none focus:ring-2 focus:ring-orbit/20" />
            <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
              options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }]} />
          </div>
          <p className="mt-4 text-sm text-slate" aria-live="polite">
            {total} {total === 1 ? 'profissional' : 'profissionais'}{filtering && ` · ${visible.length} no filtro`}
          </p>

          {visible.length === 0 ? (
            <div className="mt-4"><EmptyState title="Nada encontrado">Ajuste a busca ou o filtro de status.</EmptyState></div>
          ) : (
            <ul aria-label="Lista de profissionais" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p) => {
                const names = p.serviceIds.map((id) => serviceName.get(id)).filter((n): n is string => !!n)
                return (
                  <li key={p.id} className={`flex flex-col rounded-panel border border-hairline bg-surface p-5 ${p.is_active ? '' : 'opacity-75'}`}>
                    <div className="flex items-start gap-3">
                      <span aria-hidden="true" style={{ backgroundColor: p.color }} className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white">{initials(p.name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.name}</p>
                        <span className={`mt-0.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${p.is_active ? 'bg-ok-soft text-ok' : 'bg-paper text-slate'}`}>{p.is_active ? 'Ativo' : 'Inativo'}</span>
                      </div>
                    </div>
                    {isOwner && <p className="mt-3 text-xs font-medium text-slate">Comissão: {commissionLabel(p.id)}</p>}
                    {p.bio && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate">{p.bio}</p>}
                    <div className="mt-3 flex-1">
                      {names.length === 0 ? (
                        <p className="text-sm text-slate">Nenhum serviço vinculado.</p>
                      ) : (
                        <ul aria-label={`Serviços de ${p.name}`} className="flex flex-wrap gap-1.5">
                          {names.slice(0, 3).map((n) => <li key={n} className="rounded-full bg-orbit-soft px-2.5 py-1 text-xs font-medium text-orbit-deep">{n}</li>)}
                          {names.length > 3 && <li className="rounded-full bg-paper px-2.5 py-1 text-xs font-medium text-slate">+{names.length - 3}</li>}
                        </ul>
                      )}
                    </div>
                    {isOwner && (
                      <div className="mt-4 flex items-center gap-1.5 border-t border-hairline pt-3">
                        <Switch checked={p.is_active} disabled={togglingId === p.id} label={`${p.name}: ${p.is_active ? 'desativar' : 'ativar'}`} onChange={(next) => void toggle(p, next)} />
                        <span className="flex-1" />
                        <Button variant="ghost" className="h-9 px-3" onClick={() => setCommissionEditing(p)} aria-label={`Configurar comissão de ${p.name}`}>Comissão</Button>
                        <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>Editar</Button>
                        <Button variant="ghost" className="h-9 px-3 hover:!text-danger" onClick={() => { setDeleteError(''); setDeleting(p) }} aria-label={`Excluir ${p.name}`}>Excluir</Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {isOwner && commissionEditing && <CommissionSettingsModal key={commissionEditing.id} establishmentId={est.id}
        professionalId={commissionEditing.id} professionalName={commissionEditing.name}
        settings={commissionById.get(commissionEditing.id)} onClose={() => setCommissionEditing(null)}
        onSaved={() => { setCommissionEditing(null); notify('Comissão atualizada.'); void loadCommissions() }} />}
      {editing && data && (
        <ProfessionalForm professional={editing === 'new' ? null : editing} services={data.services} establishmentId={est.id}
          onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); notify(m); void load() }} />
      )}
      {deleting && (
        <Modal title="Excluir profissional?" onClose={() => setDeleting(null)} busy={deleteBusy}
          footer={<>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancelar</Button>
            <Button onClick={() => void confirmDelete()} loading={deleteBusy} className="!bg-danger hover:!bg-danger/90">Excluir</Button>
          </>}>
          <div className="space-y-4">
            {deleteError && <Alert>{deleteError}</Alert>}
            <p className="text-sm leading-relaxed text-graphite">
              <strong>{deleting.name}</strong> será removido junto com os vínculos de serviços e horários. Se já houver agendamentos
              com este profissional, a exclusão é bloqueada — nesse caso, desative-o.
            </p>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  )
}
