import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/errors'
import { centsToInput, formatBRL, formatDuration, parseBRL } from '@/lib/money'
import { fieldErrors, serviceSchema } from '@/lib/validation'
import { useAccount } from '@/features/establishments/AccountProvider'
import type { Service } from '@/types/models'
import { createService, deleteService, listServices, setServiceActive, updateService, type ServiceInput } from './api'

interface FormState { name: string; description: string; category: string; price: string; duration: string; isActive: boolean }
const EMPTY: FormState = { name: '', description: '', category: '', price: '', duration: '30', isActive: true }

function ServiceForm({ service, categories, establishmentId, onClose, onSaved }: {
  service: Service | null
  categories: string[]
  establishmentId: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<FormState>(service ? {
    name: service.name, description: service.description ?? '', category: service.category ?? '',
    price: centsToInput(service.price_cents), duration: String(service.duration_minutes), isActive: service.is_active,
  } : EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const parsed = serviceSchema.safeParse(form)
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return }
    setErrors({})
    const v = parsed.data
    const input: ServiceInput = {
      name: v.name,
      description: v.description || null,
      category: v.category || null,
      price_cents: parseBRL(v.price) ?? 0,
      duration_minutes: Number(v.duration),
      is_active: v.isActive,
    }
    setSaving(true)
    try {
      if (service) await updateService(service.id, establishmentId, input)
      else await createService(establishmentId, input)
      onSaved(service ? 'Serviço atualizado.' : 'Serviço criado.')
    } catch (err) {
      setFormError(describeError(err, 'Não foi possível salvar o serviço.'))
      setSaving(false)
    }
  }

  return (
    <Modal title={service ? 'Editar serviço' : 'Novo serviço'} onClose={onClose} busy={saving}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button type="submit" form="service-form" variant="accent" loading={saving}>{service ? 'Salvar alterações' : 'Criar serviço'}</Button>
      </>}>
      <form id="service-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Nome" data-autofocus value={form.name} maxLength={80} error={errors.name}
          onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Corte masculino" />
        <TextAreaField label="Descrição (opcional)" value={form.description} maxLength={500} error={errors.description}
          onChange={(e) => set('description', e.target.value)} />
        <TextField label="Categoria (opcional)" list="service-categories" value={form.category} maxLength={40} error={errors.category}
          onChange={(e) => set('category', e.target.value)} placeholder="Ex.: Cabelo, Barba, Unhas" />
        <datalist id="service-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Preço (R$)" inputMode="decimal" value={form.price} error={errors.price}
            onChange={(e) => set('price', e.target.value)} placeholder="45,00" />
          <TextField label="Duração (minutos)" inputMode="numeric" value={form.duration} error={errors.duration}
            hint="De 5 a 720 minutos." onChange={(e) => set('duration', e.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-control border border-hairline px-4 py-3">
          <div>
            <p className="text-sm font-medium text-graphite">Serviço ativo</p>
            <p className="text-[0.8125rem] text-slate">Serviços inativos ficam guardados, mas fora de uso.</p>
          </div>
          <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="Serviço ativo" />
        </div>
      </form>
    </Modal>
  )
}

function ConfirmDelete({ service, busy, error, onCancel, onConfirm }: {
  service: Service; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void
}) {
  return (
    <Modal title="Excluir serviço?" onClose={onCancel} busy={busy}
      footer={<>
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button onClick={onConfirm} loading={busy} className="!bg-danger hover:!bg-danger/90">Excluir</Button>
      </>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm leading-relaxed text-graphite">
          <strong>{service.name}</strong> será removido do catálogo e dos profissionais vinculados.
          Se já houver agendamentos com este serviço, a exclusão é bloqueada — nesse caso, desative-o.
        </p>
      </div>
    </Modal>
  )
}

export default function ServicesPage() {
  const { current } = useAccount()
  const est = current!.establishment
  const isOwner = current!.role === 'owner'
  const { toast, notify } = useToast()

  const [services, setServices] = useState<Service[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<Service | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Service | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setServices(await listServices(est.id)) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar os serviços.')) }
  }, [est.id])

  useEffect(() => { setServices(null); void load() }, [load])

  const categories = useMemo(
    () => [...new Set((services ?? []).map((s) => s.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [services],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt-BR')
    return (services ?? []).filter((s) =>
      (status === 'all' || (status === 'active') === s.is_active) &&
      (!category || s.category === category) &&
      (!q || `${s.name} ${s.category ?? ''} ${s.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(q)))
  }, [services, query, status, category])

  async function toggle(s: Service, next: boolean) {
    setTogglingId(s.id)
    try {
      await setServiceActive(s.id, est.id, next)
      notify(next ? 'Serviço ativado.' : 'Serviço desativado.')
      await load()
    } catch (e) { notify(describeError(e, 'Não foi possível alterar o status.'), 'danger') }
    finally { setTogglingId(null) }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await deleteService(deleting.id, est.id)
      setDeleting(null)
      notify('Serviço excluído.')
      await load()
    } catch (e) { setDeleteError(describeError(e, 'Não foi possível excluir o serviço.')) }
    finally { setDeleteBusy(false) }
  }

  if (error) return <ErrorState title="Serviços indisponíveis" message={error} onRetry={() => void load()} />

  const activeCount = (services ?? []).filter((s) => s.is_active).length
  const filtering = query.trim() !== '' || status !== 'all' || category !== ''

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">Serviços</h1>
          <p className="mt-1.5 text-slate">O que {est.name} oferece, com preço e duração.</p>
        </div>
        {isOwner && <Button variant="accent" onClick={() => setEditing('new')}>Novo serviço</Button>}
      </header>

      {!isOwner && <div className="mt-6"><Alert tone="info">Somente proprietários criam e editam serviços. Você pode consultar a lista.</Alert></div>}

      {!services ? (
        <div className="mt-16 flex items-center justify-center gap-3 text-slate"><Spinner />Carregando serviços…</div>
      ) : services.length === 0 ? (
        <div className="mt-10">
          <EmptyState title="Nenhum serviço cadastrado">
            {isOwner ? 'Cadastre o primeiro serviço para poder vinculá-lo aos profissionais e, depois, agendar.' : 'O proprietário ainda não cadastrou serviços.'}
          </EmptyState>
          {isOwner && <div className="mt-5 flex justify-center"><Button variant="accent" onClick={() => setEditing('new')}>Cadastrar primeiro serviço</Button></div>}
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
            <input type="search" aria-label="Buscar serviço" placeholder="Buscar por nome, categoria ou descrição" value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 w-full rounded-control border border-hairline bg-surface px-3.5 text-[0.95rem] placeholder:text-slate/60 focus:border-orbit focus:outline-none focus:ring-2 focus:ring-orbit/20" />
            <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
              options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }]} />
            <SelectField label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)}
              options={[{ value: '', label: 'Todas' }, ...categories.map((c) => ({ value: c, label: c }))]} />
          </div>
          <p className="mt-4 text-sm text-slate" aria-live="polite">
            {services.length} {services.length === 1 ? 'serviço' : 'serviços'} · {activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}
            {filtering && ` · ${visible.length} no filtro`}
          </p>

          {visible.length === 0 ? (
            <div className="mt-4"><EmptyState title="Nada encontrado">Ajuste a busca ou os filtros para ver outros serviços.</EmptyState></div>
          ) : (
            <ul aria-label="Lista de serviços" className="mt-4 divide-y divide-hairline overflow-hidden rounded-panel border border-hairline bg-surface">
              {visible.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className={`truncate font-medium ${s.is_active ? '' : 'text-slate'}`}>
                      {s.name}
                      {!s.is_active && <span className="ml-2 rounded-full bg-paper px-2.5 py-0.5 align-middle text-xs font-medium text-slate">Inativo</span>}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-slate">
                      {[s.category, s.description].filter(Boolean).join(' · ') || 'Sem categoria'}
                    </p>
                  </div>
                  <p className="w-20 text-sm tabular-nums text-graphite">{formatDuration(s.duration_minutes)}</p>
                  <p className="w-24 text-right font-display font-semibold tabular-nums">{formatBRL(s.price_cents)}</p>
                  {isOwner && (
                    <div className="flex items-center gap-1.5">
                      <Switch checked={s.is_active} disabled={togglingId === s.id} label={`${s.name}: ${s.is_active ? 'desativar' : 'ativar'}`}
                        onChange={(next) => void toggle(s, next)} />
                      <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing(s)} aria-label={`Editar ${s.name}`}>Editar</Button>
                      <Button variant="ghost" className="h-9 px-3 hover:!text-danger" onClick={() => { setDeleteError(''); setDeleting(s) }} aria-label={`Excluir ${s.name}`}>Excluir</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {editing && (
        <ServiceForm service={editing === 'new' ? null : editing} categories={categories} establishmentId={est.id}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); notify(m); void load() }} />
      )}
      {deleting && <ConfirmDelete service={deleting} busy={deleteBusy} error={deleteError} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()} />}
      {toast}
    </div>
  )
}
