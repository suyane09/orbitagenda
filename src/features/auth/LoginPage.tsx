import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { fieldErrors, signInSchema } from '@/lib/validation'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword(parsed.data)
    setLoading(false)
    if (error) return setFormError(describeError(error))
    const from = (location.state as { from?: string } | null)?.from
    // Só aceita caminhos internos para evitar redirecionamento aberto.
    let pending = ''
    try { pending = sessionStorage.getItem('orbit:pending-invite') ?? ''; sessionStorage.removeItem('orbit:pending-invite') } catch { /* navegador privado */ }
    const target = from && from.startsWith('/') && !from.startsWith('//') ? from :
      /^\/aceitar-convite\/[a-f0-9]{64}$/.test(pending) ? pending : '/app'
    navigate(target, { replace: true })
  }

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Acesse a agenda do seu estabelecimento."
      footer={<>Ainda não tem conta? <Link to="/cadastro" className="font-medium text-orbit hover:underline">Criar conta</Link></>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
        <div>
          <TextField label="Senha" name="password" type="password" autoComplete="current-password" error={errors.password} />
          <div className="mt-2 text-right text-sm">
            <Link to="/recuperar-senha" className="text-slate hover:text-ink hover:underline">Esqueci minha senha</Link>
          </div>
        </div>
        <Button type="submit" full loading={loading}>Entrar</Button>
      </form>
    </AuthLayout>
  )
}
