
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

type Service = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  price_cents: number
}

type Professional = {
  id: string
  name: string
  bio: string | null
}

type Link = {
  professional_id: string
  service_id: string
}

type Slot = {
  slot_start: string
  slot_end: string
}

type Catalog = {
  establishment: { name: string; slug: string; business_type: string }
  services: Service[]
  professionals: Professional[]
  professional_services: Link[]
}

function localDate(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Maceio',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Maceio',
  }).format(new Date(iso))
}

export default function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [date, setDate] = useState(localDate())
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let active = true

    async function loadCatalog() {
      setLoading(true)
      setError('')

      const { data, error: requestError } = await supabase.functions.invoke(
        'public-booking',
        { body: { action: 'catalog', slug } },
      )

      if (!active) return

      if (requestError || !data?.establishment) {
        setError('Não foi possível carregar este estabelecimento.')
      } else {
        setCatalog(data as Catalog)
      }
      setLoading(false)
    }

    void loadCatalog()
    return () => { active = false }
  }, [slug])

  const availableProfessionals = catalog?.professionals.filter((professional) =>
    catalog.professional_services.some(
      (link) =>
        link.professional_id === professional.id &&
        link.service_id === serviceId,
    ),
  ) ?? []

  useEffect(() => {
    if (!slug || !serviceId || !professionalId || !date) {
      setSlots([])
      return
    }

    let active = true

    async function loadSlots() {
      setLoadingSlots(true)
      setSelectedSlot('')
      setError('')

      const { data, error: requestError } = await supabase.functions.invoke(
        'public-booking',
        {
          body: {
            action: 'availability',
            slug,
            professional_id: professionalId,
            service_id: serviceId,
            date,
          },
        },
      )

      if (!active) return

      if (requestError || !Array.isArray(data?.slots)) {
        setError('Não foi possível consultar os horários.')
        setSlots([])
      } else {
        setSlots(data.slots as Slot[])
      }
      setLoadingSlots(false)
    }

    void loadSlots()
    return () => { active = false }
  }, [slug, serviceId, professionalId, date])

  async function confirmBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!slug || !selectedSlot || submitting) return

    setSubmitting(true)
    setError('')

    const time = formatTime(selectedSlot)

    const { data, error: requestError } = await supabase.functions.invoke(
      'public-booking',
      {
        body: {
          action: 'book',
          slug,
          professional_id: professionalId,
          service_id: serviceId,
          date,
          time,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.replace(/\D/g, ''),
        },
      },
    )

    setSubmitting(false)

    if (requestError || !data?.booking_id) {
      setError('Não foi possível concluir a reserva. O horário pode ter sido ocupado.')
      setSelectedSlot('')
      return
    }

    setSuccess(true)
  }

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500'

  if (loading) {
    return <main className="min-h-screen bg-slate-50 p-8 text-center">Carregando agendamento...</main>
  }

  if (!catalog) {
    return <main className="min-h-screen bg-slate-50 p-8 text-center">{error || 'Estabelecimento não encontrado.'}</main>
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-5 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Agendamento online
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {catalog.establishment.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escolha seu serviço e reserve o melhor horário.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-10">
        {success ? (
          <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mb-4 text-4xl">✓</div>
            <h2 className="text-2xl font-bold">Agendamento realizado!</h2>
            <p className="mt-3 text-slate-600">
              Sua reserva foi registrada com sucesso.
            </p>
            <p className="mt-4 font-semibold">
              {date.split('-').reverse().join('/')} às {formatTime(selectedSlot)}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-7 rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white"
            >
              Fazer outro agendamento
            </button>
          </section>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <div className="space-y-7">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="mb-5 text-lg font-bold">01. Escolha o serviço</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {catalog.services.map((service) => (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => {
                        setServiceId(service.id)
                        setProfessionalId('')
                        setSelectedSlot('')
                      }}
                      className={`rounded-xl border p-4 text-left transition ${
                        serviceId === service.id
                          ? 'border-indigo-600 bg-indigo-50'
                          : 'border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      <span className="block font-semibold">{service.name}</span>
                      <span className="mt-2 block text-sm text-slate-500">
                        {service.duration_minutes} min · {formatMoney(service.price_cents)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {serviceId && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-5 text-lg font-bold">02. Escolha o profissional</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {availableProfessionals.map((professional) => (
                      <button
                        key={professional.id}
                        type="button"
                        onClick={() => setProfessionalId(professional.id)}
                        className={`rounded-xl border p-4 text-left transition ${
                          professionalId === professional.id
                            ? 'border-indigo-600 bg-indigo-50'
                            : 'border-slate-200 hover:border-slate-400'
                        }`}
                      >
                        <span className="font-semibold">{professional.name}</span>
                        {professional.bio && (
                          <p className="mt-1 text-sm text-slate-500">{professional.bio}</p>
                        )}
                      </button>
                    ))}
                  </div>
                  {availableProfessionals.length === 0 && (
                    <p className="text-sm text-slate-500">
                      Nenhum profissional disponível para este serviço.
                    </p>
                  )}
                </section>
              )}

              {professionalId && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-5 text-lg font-bold">03. Data e horário</h2>
                  <label className="mb-2 block text-sm font-medium">Data desejada</label>
                  <input
                    type="date"
                    value={date}
                    min={localDate()}
                    max={localDate(60)}
                    onChange={(event) => setDate(event.target.value)}
                    className={inputClass}
                  />

                  <h3 className="mb-3 mt-6 text-sm font-semibold">Horários disponíveis</h3>
                  {loadingSlots ? (
                    <p className="text-sm text-slate-500">Consultando horários...</p>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-slate-500">Nenhum horário disponível nesta data.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {slots.map((slot) => (
                        <button
                          key={slot.slot_start}
                          type="button"
                          onClick={() => setSelectedSlot(slot.slot_start)}
                          className={`rounded-lg border px-2 py-3 text-sm font-semibold ${
                            selectedSlot === slot.slot_start
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-slate-200 bg-white hover:border-indigo-400'
                          }`}
                        >
                          {formatTime(slot.slot_start)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {selectedSlot && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-5 text-lg font-bold">04. Seus dados</h2>
                  <form onSubmit={(event) => void confirmBooking(event)} className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium">Nome completo</label>
                      <input
                        required
                        minLength={2}
                        maxLength={120}
                        value={customerName}
                        onChange={(event) => setCustomerName(event.target.value)}
                        className={inputClass}
                        placeholder="Digite seu nome"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium">WhatsApp</label>
                      <input
                        required
                        type="tel"
                        value={customerPhone}
                        onChange={(event) => setCustomerPhone(event.target.value)}
                        className={inputClass}
                        placeholder="(82) 99999-9999"
                      />
                    </div>
                    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-xl bg-indigo-600 px-6 py-4 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submitting ? 'Confirmando...' : 'Confirmar agendamento'}
                    </button>
                  </form>
                </section>
              )}

              {error && !selectedSlot && (
                <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Sua reserva
              </p>
              <h2 className="mt-2 text-xl font-bold">{catalog.establishment.name}</h2>
              <div className="mt-6 space-y-4 border-t border-slate-100 pt-5 text-sm">
                <div>
                  <p className="text-slate-500">Serviço</p>
                  <p className="mt-1 font-semibold">
                    {catalog.services.find((s) => s.id === serviceId)?.name || 'Não selecionado'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Profissional</p>
                  <p className="mt-1 font-semibold">
                    {catalog.professionals.find((p) => p.id === professionalId)?.name || 'Não selecionado'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Data e horário</p>
                  <p className="mt-1 font-semibold">
                    {selectedSlot
                      ? `${date.split('-').reverse().join('/')} às ${formatTime(selectedSlot)}`
                      : 'Não selecionado'}
                  </p>
                </div>
              </div>
              <div className="mt-6 border-t border-slate-100 pt-5">
                <p className="text-xs text-slate-400">Agendamento seguro</p>
                <p className="mt-1 text-xs text-slate-500">
                  Seus dados serão utilizados para registrar sua reserva.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  )
}
