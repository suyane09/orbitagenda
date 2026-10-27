import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from '@/features/establishments/AccountProvider'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { BRAZIL_TIMEZONES, BUSINESS_TYPES, establishmentSchema, fieldErrors } from '@/lib/validation'
import { supabase } from '@/lib/supabase'

const panel = 'min-w-0 rounded-xl border border-hairline bg-surface p-4 sm:p-6'

export default function EstablishmentSettingsPage() {
  const { current, refresh } = useAccount()
  const est = current?.establishment
  const isOwner = current?.role === 'owner'
  const [name,setName] = useState(est?.name ?? '')
  const [businessType,setBusinessType] = useState<string>(est?.business_type ?? 'barbershop')
  const [phone,setPhone] = useState(est?.phone ?? '')
  const [timezone,setTimezone] = useState(est?.timezone ?? 'America/Maceio')
  const [errors,setErrors] = useState<Record<string,string>>({})
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')

  useEffect(() => {
    setName(est?.name ?? '');setBusinessType(est?.business_type ?? 'barbershop')
    setPhone(est?.phone ?? '');setTimezone(est?.timezone ?? 'America/Maceio')
    setError('');setSuccess('');setErrors({})
  },[est?.id])

  const url = est ? `${window.location.origin}/agendar/${est.slug}` : ''

  async function save(e:FormEvent) {
    e.preventDefault()
    if (!est || !isOwner || saving) return
    setError('');setSuccess('')
    const parsed = establishmentSchema.safeParse({name,businessType,phone,timezone})
    if(!parsed.success) {setErrors(fieldErrors(parsed.error));return}
    setErrors({})
    setSaving(true)
    try {
      const {data,error:err}=await supabase.from('establishments')
        .update({name:parsed.data.name, business_type:parsed.data.businessType,
          phone:parsed.data.phone?.trim() || null, timezone:parsed.data.timezone})
        .eq('id',est.id).select('id')
      if(err)throw err
      if(!data?.length)throw Error('Não foi possível atualizar este estabelecimento.')
      await refresh(est.id)
      setSuccess('Informações salvas com sucesso.')
    } catch(e) {setError(describeError(e,'Não foi possível salvar as alterações.'))}
    finally {setSaving(false)}
  }
  if(!isOwner || !est)return <div className={panel}><h1 className="font-display text-xl font-semibold">Estabelecimento</h1><p className="mt-2 text-sm text-slate">Somente o proprietário pode editar estas informações.</p></div>
  return <div className="w-full min-w-0 space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <header>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-slate">Configurações</p>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">Meu estabelecimento</h1>
      <p className="mt-2 text-sm text-slate">Mantenha as informações da empresa atualizadas e compartilhe sua agenda pública.</p>
    </header>
    {error&&<p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger">{error}</p>}
    {success&&<p role="status" className="rounded-lg bg-ok-soft p-4 text-sm text-ok">{success}</p>}
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(270px,340px)]">
      <section className={panel}>
        <h2 className="font-display text-lg font-semibold">Dados da empresa</h2>
        <form onSubmit={e=>void save(e)} className="mt-5 space-y-4">
          <TextField label="Nome do estabelecimento" value={name} required onChange={e=>setName(e.target.value)} error={errors.name}/>
          <SelectField label="Tipo de empresa" value={businessType} onChange={e=>setBusinessType(e.target.value)} options={BUSINESS_TYPES} error={errors.businessType}/>
          <TextField label="Telefone para contato" type="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} error={errors.phone} placeholder="(82) 99999-9999"/>
          <SelectField label="Fuso horário do estabelecimento" value={timezone} onChange={e=>setTimezone(e.target.value)} options={BRAZIL_TIMEZONES} error={errors.timezone}/>
          <p className="text-xs leading-relaxed text-slate">O fuso horário determina os dias e horários da agenda e dos relatórios. Altere apenas se sua empresa estiver localizada em outra região.</p>
          <Button type="submit" loading={saving}>Salvar informações</Button>
        </form>
      </section>
      <div className="space-y-5">
        <section className={panel}>
          <h2 className="font-display text-lg font-semibold">Seu link de agendamento</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate">Compartilhe com clientes no Instagram, WhatsApp ou Google. Eles podem reservar sem acessar o painel administrativo.</p>
          <input aria-label="Link público de agendamento" className="mt-4 w-full rounded-lg border border-hairline bg-paper px-3 py-3 text-xs text-ink" readOnly value={url} onFocus={e=>e.currentTarget.select()}/>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={()=>void navigator.clipboard.writeText(url).then(()=>setSuccess('Link copiado para a área de transferência.')).catch(()=>setError('Copie o link selecionando o campo acima.'))}>Copiar link</Button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-lg border border-hairline px-4 text-sm font-medium text-ink hover:bg-paper">Visualizar</a>
          </div>
          <p className="mt-4 text-xs text-slate">Endereço permanente: <strong>{est.slug}</strong>. Para preservar os links já enviados, o identificador da empresa não é alterado nesta tela.</p>
        </section>
        <section className={panel}>
          <h2 className="font-display text-lg font-semibold">Equipe e permissões</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate">Gerencie quem pode acessar sua agenda. Convites de funcionários não concedem permissão ao financeiro.</p>
          <Link to="/app/equipe" className="mt-4 inline-flex h-10 items-center rounded-lg border border-hairline px-4 text-sm font-medium hover:bg-paper">Gerenciar equipe</Link>
        </section>
      </div>
    </div>
  </div>
}
