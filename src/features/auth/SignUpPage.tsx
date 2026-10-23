import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { fieldErrors, signUpSchema } from '@/lib/validation'

export default function SignUpPage() {
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const parsed = signUpSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setLoading(true)
    // Só nome é enviado como metadata. O papel NUNCA vem do cliente.
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName }, emailRedirectTo: `${window.location.origin}/entrar` },
    })
    setLoading(false)
    if (error) return setFormError(describeError(error))
    if (data.session) {
      let pending = ''
      try { pending = sessionStorage.getItem('orbit:pending-invite') ?? ''; sessionStorage.removeItem('orbit:pending-invite') } catch { /* ignorar */ }
      return navigate(/^\/aceitar-convite\/[a-f0-9]{64}$/.test(pending) ? pending : '/criar-estabelecimento', { replace: true })
    }
    setSentTo(parsed.data.email)
  }

  if (sentTo) {
    return (
      <AuthLayout title="Confira seu e-mail" subtitle={`Enviamos um link de confirmação para ${sentTo}.`}
        footer={<Link to="/entrar" className="font-medium text-orbit hover:underline">Voltar para entrar</Link>}>
        <Alert tone="info">Clique no link da mensagem para ativar sua conta. Se recebeu convite para uma equipe, entre com este mesmo e-mail após a confirmação. Se não encontrar a mensagem, olhe a caixa de spam.</Alert>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Criar conta"
      subtitle="Leva um minuto. Depois você cadastra seu estabelecimento."
      footer={<>Já tem conta? <Link to="/entrar" className="font-medium text-orbit hover:underline">Entrar</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Seu nome" name="fullName" autoComplete="name" error={errors.fullName} />
        <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
        <TextField label="Senha" name="password" type="password" autoComplete="new-password" hint="Mínimo de 8 caracteres, com letras e números." error={errors.password} />
        <TextField label="Confirmar senha" name="confirm" type="password" autoComplete="new-password" error={errors.confirm} />
        <Button type="submit" full loading={loading}>Criar conta</Button>
      </form>
    </AuthLayout>
  )
}
