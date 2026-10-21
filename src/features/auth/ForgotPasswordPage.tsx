import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { fieldErrors, forgotSchema } from '@/lib/validation'

export default function ForgotPasswordPage() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFormError(null)
    const parsed = forgotSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setLoading(false)
    if (error) return setFormError(describeError(error))
    setDone(true) // Mesma resposta exista ou não a conta: não revela quem é cliente.
  }

  return (
    <AuthLayout
      title="Recuperar senha"
      subtitle="Informe seu e-mail e enviaremos um link para criar uma nova senha."
      footer={<Link to="/entrar" className="font-medium text-orbit hover:underline">Voltar para entrar</Link>}
    >
      {done ? (
        <Alert tone="ok">Se houver uma conta com esse e-mail, o link de recuperação já está a caminho. Ele vale por tempo limitado.</Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {formError && <Alert>{formError}</Alert>}
          <TextField label="E-mail" name="email" type="email" autoComplete="email" inputMode="email" error={errors.email} />
          <Button type="submit" full loading={loading}>Enviar link</Button>
        </form>
      )}
    </AuthLayout>
  )
}
