import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { describeError } from '@/lib/errors'
import { formatBRL } from '@/lib/money'
import {
  APPOINTMENT_STATUS, NOTES_MAX, customerSchema, findDuplicate, fold, formatPhone, phoneKey, whatsappUrl, type CustomerForm,
} from '@/lib/customers'
import { fieldErrors } from '@/lib/validation'
import { useAccount } from '@/features/establishments/AccountProvider'
import {
  createCustomer, deleteCustomer, loadCustomers, loadHistory, updateCustomer,
  type Customer, type CustomersData, type HistoryItem,
} from './api'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')
const fmtDate = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const fmtDay = (iso: string, tz: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))

type Filter = 'all' | 'history' | 'no_history' | 'no_phone' | 'no_email'
type Sort = 'name' | 'recent' | 'visit'

function CustomerFormModal({ customer, all, establishmentId, onClose, onSaved }: {
  customer: Customer | null
  all: Customer[]
  establishmentId: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<CustomerForm>({
    fullName: customer?.full_name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', notes: customer?.notes ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    const parsed = customerSchema.safeParse(form)
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return }
    const v = parsed.data
    const dup = findDuplicate(all, v, customer?.id ?? null)
    if (dup) {
      const msg = dup.by === 'phone' ? `Este telefone já pertence a ${dup.customer.full_name}.` : `Este e-mail já pertence a ${dup.customer.full_name}.`
      setErrors({ [dup.by]: msg })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const input = { full_name: v.fullName, phone: v.phone || null, email: v.email || null, notes: v.notes || null }
      if (customer) await updateCustomer(customer.id, establishmentId, input)
      else await createCustomer(establishmentId, input)
      onSaved(customer ? 'Cliente atualizado.' : 'Cliente cadastrado.')
    } catch (err) {
      setFormError(describeError(err, 'Não foi possível salvar o cliente.'))
      setSaving(false)
    }
  }

  return (
    <Modal title={customer ? 'Editar cliente' : 'Novo cliente'} onClose={onClose} busy={saving}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button type="submit" form="customer-form" variant="accent" loading={saving}>{customer ? 'Salvar alterações' : 'Cadastrar cliente'}</Button>
      </>}>
      <form id="customer-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Nome completo" data-autofocus autoComplete="off" value={form.fullName} maxLength={120} error={errors.fullName}
          onChange={(e) => set('fullName', e.target.value)} placeholder="Ex.: Ana Souza" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Telefone / WhatsApp" type="tel" inputMode="tel" autoComplete="off" value={form.phone} maxLength={30} error={errors.phone}
            onChange={(e) => set('phone', e.target.value)} placeholder="(79) 99999-0000" />
          <TextField label="E-mail (opcional)" type="email" autoComplete="off" value={form.email} maxLength={254} error={errors.email}
            onChange={(e) => set('email', e.target.value)} placeholder="ana@exemplo.com" />
        </div>
        <TextAreaField label="Observações (opcional)" value={form.notes} maxLength={NOTES_MAX} error={errors.notes}
          hint="Preferências, alergias, detalhes úteis no atendimento." onChange={(e) => set('notes', e.target.value)} />
      </form>
    </Modal>
  )
}

function CustomerDetail({ customer, stats, establishmentId, timeZone, isOwner, onClose, onEdit, onDelete }: {
  customer: Customer
  stats: CustomersData['stats'][string] | undefined
  establishmentId: string
  timeZone: string
  isOwner: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [history, setHistory] = useState<HistoryItem[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    loadHistory(establishmentId, customer.id)
      .then((h) => { if (alive) setHistory(h) })
      .catch((e) => { if (alive) setError(describeError(e, 'Não foi possível carregar o histórico.')) })
    return () => { alive = false }
  }, [establishmentId, customer.id])

  const wa = whatsappUrl(customer.phone)
  return (
    <Modal title={customer.full_name} onClose={onClose}
      footer={<>
        {isOwner && <Button variant="ghost" className="hover:!text-danger sm:mr-auto" onClick={onDelete}>Excluir</Button>}
        <Button variant="outline" onClick={onClose}>Fechar</Button>
        <Button variant="accent" onClick={onEdit}>Editar</Button>
      </>}>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate">Telefone</dt><dd className="mt-0.5 font-medium">{customer.phone ? formatPhone(customer.phone) : '—'}{wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-2 text-orbit underline">WhatsApp</a>}</dd></div>
        <div><dt className="text-slate">E-mail</dt><dd className="mt-0.5 break-all font-medium">{customer.email ?? '—'}</dd></div>
        <div><dt className="text-slate">Cliente desde</dt><dd className="mt-0.5 font-medium">{fmtDay(customer.created_at, timeZone)}</dd></div>
        <div><dt className="text-slate">Atendimentos concluídos</dt><dd className="mt-0.5 font-medium">{stats?.completed ?? 0}{stats?.lastVisit && ` · último em ${fmtDay(stats.lastVisit, timeZone)}`}</dd></div>
      </dl>
      {customer.notes && (
        <div className="mt-4 rounded-control bg-paper px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate">Observações</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-graphite">{customer.notes}</p>
        </div>
      )}

      <h3 className="mt-6 font-display text-base font-semibold">Histórico</h3>
      {error ? <div className="mt-2"><Alert>{error}</Alert></div>
        : !history ? <div className="mt-4 flex items-center gap-2 text-sm text-slate"><Spinner className="size-4" />Carregando…</div>
        : history.length === 0 ? <div className="mt-2"><EmptyState title="Sem agendamentos">Os agendamentos e atendimentos deste cliente aparecerão aqui.</EmptyState></div>
        : (
          <ul aria-label="Histórico de agendamentos" className="mt-2 divide-y divide-hairline rounded-control border border-hairline">
            {history.map((h) => {
              const st = APPOINTMENT_STATUS[h.status] ?? { label: h.status, tone: 'muted' as const }
              const tone = { ok: 'bg-ok-soft text-ok', info: 'bg-orbit-soft text-orbit-deep', muted: 'bg-paper text-slate', danger: 'bg-danger-soft text-danger' }[st.tone]
              return (
                <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate text-sm font-medium">{h.service}</p>
                    <p className="text-[0.8125rem] text-slate">{fmtDate(h.starts_at, timeZone)} · {h.professional}</p>
                  </div>
                  <span className="text-sm tabular-nums text-graphite">{formatBRL(h.price_cents)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{st.label}</span>
                </li>
              )
            })}
          </ul>
        )}
    </Modal>
  )
}

export default function CustomersPage() {
  const { current } = useAccount()
  const est = current!.establishment
  const isOwner = current!.role === 'owner'
  const { toast, notify } = useToast()

  const [data, setData] = useState<CustomersData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [viewing, setViewing] = useState<Customer | null>(null)
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Customer | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try { setData(await loadCustomers(est.id)) }
    catch (e) { setError(describeError(e, 'Não foi possível carregar os clientes.')) }
  }, [est.id])
  useEffect(() => { setData(null); void load() }, [load])

  const visible = useMemo(() => {
    if (!data) return []
    const q = fold(query.trim())
    const qDigits = query.replace(/\D/g, '')
    const list = data.customers.filter((c) => {
      const total = data.stats[c.id]?.total ?? 0
      if (filter === 'history' && total === 0) return false
      if (filter === 'no_history' && total > 0) return false
      if (filter === 'no_phone' && c.phone) return false
      if (filter === 'no_email' && c.email) return false
      if (!q) return true
      return fold(c.full_name).includes(q) || fold(c.email ?? '').includes(q) || (qDigits.length >= 3 && !!c.phone && phoneKey(c.phone).includes(phoneKey(qDigits)))
    })
    const by = {
      name: (a: Customer, b: Customer) => a.full_name.localeCompare(b.full_name, 'pt-BR'),
      recent: (a: Customer, b: Customer) => b.created_at.localeCompare(a.created_at),
      visit: (a: Customer, b: Customer) => (data.stats[b.id]?.lastVisit ?? '').localeCompare(data.stats[a.id]?.lastVisit ?? '') || a.full_name.localeCompare(b.full_name, 'pt-BR'),
    }[sort]
    return [...list].sort(by)
  }, [data, query, filter, sort])

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await deleteCustomer(deleting.id, est.id)
      setDeleting(null); setViewing(null)
      notify('Cliente excluído.')
      await load()
    } catch (e) {
      const code = (e as { code?: string }).code
      setDeleteError(code === '23503'
        ? 'Este cliente tem agendamentos no histórico e não pode ser excluído. Mantenha o cadastro para preservar o histórico.'
        : describeError(e, 'Não foi possível excluir o cliente.'))
    } finally { setDeleteBusy(false) }
  }

  if (error) return <ErrorState title="Clientes indisponíveis" message={error} onRetry={() => void load()} />

  const total = data?.customers.length ?? 0
  const filtering = query.trim() !== '' || filter !== 'all'

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.4rem]">Clientes</h1>
          <p className="mt-1.5 text-slate">Quem atende em {est.name}, com contato e histórico.</p>
        </div>
        <Button variant="accent" onClick={() => setEditing('new')}>Novo cliente</Button>
      </header>

      {!isOwner && <div className="mt-6"><Alert tone="info">Você pode cadastrar e editar clientes. A exclusão é restrita ao proprietário.</Alert></div>}

      {!data ? (
        <div className="mt-16 flex items-center justify-center gap-3 text-slate"><Spinner />Carregando clientes…</div>
      ) : total === 0 ? (
        <div className="mt-10">
          <EmptyState title="Nenhum cliente cadastrado">Cadastre o primeiro cliente para poder agendar atendimentos.</EmptyState>
          <div className="mt-5 flex justify-center"><Button variant="accent" onClick={() => setEditing('new')}>Cadastrar primeiro cliente</Button></div>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
            <input type="search" aria-label="Buscar cliente" placeholder="Buscar por nome, telefone ou e-mail" value={query} onChange={(e) => setQuery(e.target.value)}
              className="h-11 w-full rounded-control border border-hairline bg-surface px-3.5 text-[0.95rem] placeholder:text-slate/60 focus:border-orbit focus:outline-none focus:ring-2 focus:ring-orbit/20" />
            <SelectField label="Filtro" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}
              options={[{ value: 'all', label: 'Todos' }, { value: 'history', label: 'Com agendamentos' }, { value: 'no_history', label: 'Sem agendamentos' }, { value: 'no_phone', label: 'Sem telefone' }, { value: 'no_email', label: 'Sem e-mail' }]} />
            <SelectField label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as Sort)}
              options={[{ value: 'name', label: 'Nome (A–Z)' }, { value: 'recent', label: 'Cadastro recente' }, { value: 'visit', label: 'Última visita' }]} />
          </div>
          <p className="mt-4 text-sm text-slate" aria-live="polite">
            {total} {total === 1 ? 'cliente' : 'clientes'}{filtering && ` · ${visible.length} no filtro`}
          </p>

          {visible.length === 0 ? (
            <div className="mt-4"><EmptyState title="Nada encontrado">Ajuste a busca ou os filtros.</EmptyState></div>
          ) : (
            <ul aria-label="Lista de clientes" className="mt-4 divide-y divide-hairline overflow-hidden rounded-panel border border-hairline bg-surface">
              {visible.map((c) => {
                const s = data.stats[c.id]
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
                    <button type="button" onClick={() => setViewing(c)} aria-label={`Abrir ${c.full_name}`}
                      className="flex min-w-0 flex-1 basis-60 items-center gap-3 text-left">
                      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-orbit-soft text-sm font-semibold text-orbit-deep">{initials(c.full_name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.full_name}</span>
                        <span className="block truncate text-sm text-slate">{[c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(' · ') || 'Sem contato'}</span>
                      </span>
                    </button>
                    <p className="text-sm text-slate">
                      {s ? `${s.total} ${s.total === 1 ? 'agendamento' : 'agendamentos'}` : 'Sem agendamentos'}
                      {s?.lastVisit && ` · última visita ${fmtDay(s.lastVisit, est.timezone)}`}
                    </p>
                    <Button variant="ghost" className="h-9 px-3" onClick={() => setEditing(c)} aria-label={`Editar ${c.full_name}`}>Editar</Button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {viewing && !editing && !deleting && (
        <CustomerDetail customer={viewing} stats={data?.stats[viewing.id]} establishmentId={est.id} timeZone={est.timezone} isOwner={isOwner}
          onClose={() => setViewing(null)} onEdit={() => setEditing(viewing)} onDelete={() => { setDeleteError(''); setDeleting(viewing) }} />
      )}
      {editing && data && (
        <CustomerFormModal customer={editing === 'new' ? null : editing} all={data.customers} establishmentId={est.id}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); setViewing(null); notify(m); void load() }} />
      )}
      {deleting && (
        <Modal title="Excluir cliente?" onClose={() => setDeleting(null)} busy={deleteBusy}
          footer={<>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancelar</Button>
            <Button onClick={() => void confirmDelete()} loading={deleteBusy} className="!bg-danger hover:!bg-danger/90">Excluir</Button>
          </>}>
          <div className="space-y-4">
            {deleteError && <Alert>{deleteError}</Alert>}
            <p className="text-sm leading-relaxed text-graphite">
              O cadastro de <strong>{deleting.full_name}</strong> será removido. Clientes com agendamentos no histórico não podem ser excluídos.
            </p>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  )
}
