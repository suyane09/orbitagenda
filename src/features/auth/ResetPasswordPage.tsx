import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { FullScreenLoader } from '@/components/ui/States'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { fieldErrors, resetSchema } from '@/lib/validation'
import { useAuth } from './AuthProvider'

export default function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (loading) return <FullScreenLoader />

  if (!session) {
    return (
      <AuthLayout title="Link inválido ou expirado" subtitle="Por segurança, cada link de recuperação funciona uma única vez e por pouco tempo."
        footer={<Link to="/entrar" className="font-medium text-orbit hover:underline">Voltar para entrar</Link>}>
        <Link to="/recuperar-senha"><Button full>Pedir um novo link</Button></Link>
      </AuthLayout>
    )
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const parsed = resetSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
    setSaving(false)
    if (error) return setFormError(describeError(error))
    navigate('/app', { replace: true })
  }

  return (
    <AuthLayout title="Criar nova senha" subtitle="Escolha uma senha que você não usa em outros lugares.">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Nova senha" name="password" type="password" autoComplete="new-password" hint="Mínimo de 8 caracteres, com letras e números." error={errors.password} />
        <TextField label="Confirmar nova senha" name="confirm" type="password" autoComplete="new-password" error={errors.confirm} />
        <Button type="submit" full loading={saving}>Salvar nova senha</Button>
      </form>
    </AuthLayout>
  )
}
