import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { BRAZIL_TIMEZONES, BUSINESS_TYPES, establishmentSchema, fieldErrors } from '@/lib/validation'
import { useAuth } from '@/features/auth/AuthProvider'
import { createEstablishment } from './api'
import { useAccount } from './AccountProvider'

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { memberships, isSuperadmin, refresh } = useAccount()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Superadmin sem empresa não precisa cadastrar uma: vai para a plataforma.
  if (isSuperadmin && memberships.length === 0) return <Navigate to="/plataforma" replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const parsed = establishmentSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setLoading(true)
    try {
      const created = await createEstablishment(parsed.data)
      await refresh(created.id)
      navigate('/app/assinatura', { replace: true })
    } catch (err) {
      setFormError(describeError(err))
    } finally {
      setLoading(false)
    }
  }

  const hasEstablishment = memberships.length > 0
  return (
    <AuthLayout
      title="Cadastre seu estabelecimento"
      subtitle="Você será o proprietário. O plano mensal será apresentado antes de qualquer cobrança."
      footer={hasEstablishment
        ? <Link to="/app" className="font-medium text-orbit hover:underline">Voltar ao painel</Link>
        : <button type="button" onClick={() => void signOut()} className="font-medium text-orbit hover:underline">Sair da conta</button>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Nome do estabelecimento" name="name" autoComplete="organization" error={errors.name} />
        <SelectField label="Tipo" name="businessType" options={BUSINESS_TYPES} defaultValue="barbershop" error={errors.businessType} />
        <TextField label="Telefone (opcional)" name="phone" type="tel" autoComplete="tel" inputMode="tel" error={errors.phone} />
        <SelectField label="Fuso horário" name="timezone" options={BRAZIL_TIMEZONES} defaultValue="America/Sao_Paulo" error={errors.timezone} />
        <Button type="submit" full loading={loading}>Criar estabelecimento</Button>
      </form>
    </AuthLayout>
  )
}
