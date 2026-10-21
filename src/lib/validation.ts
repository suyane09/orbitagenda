import { z } from 'zod'

const email = z.string().trim().toLowerCase().pipe(z.email('Informe um e-mail válido.'))
const password = z
  .string()
  .min(8, 'A senha precisa ter pelo menos 8 caracteres.')
  .max(72, 'A senha pode ter no máximo 72 caracteres.')
  .regex(/[A-Za-z]/, 'Inclua pelo menos uma letra.')
  .regex(/\d/, 'Inclua pelo menos um número.')

export const signInSchema = z.object({ email, password: z.string().min(1, 'Informe sua senha.') })

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Informe seu nome.').max(120, 'Nome muito longo.'),
    email,
    password,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não coincidem.' })

export const forgotSchema = z.object({ email })

export const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As senhas não coincidem.' })

export const BRAZIL_TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (GMT-3)' },
  { value: 'America/Maceio', label: 'Alagoas, Sergipe (GMT-3)' },
  { value: 'America/Fortaleza', label: 'Ceará, Rio Grande do Norte (GMT-3)' },
  { value: 'America/Recife', label: 'Pernambuco (GMT-3)' },
  { value: 'America/Bahia', label: 'Bahia (GMT-3)' },
  { value: 'America/Belem', label: 'Pará, Amapá (GMT-3)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso (GMT-4)' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul (GMT-4)' },
  { value: 'America/Manaus', label: 'Amazonas (GMT-4)' },
  { value: 'America/Rio_Branco', label: 'Acre (GMT-5)' },
] as const

export const BUSINESS_TYPES = [
  { value: 'barbershop', label: 'Barbearia' },
  { value: 'salon', label: 'Salão de beleza' },
  { value: 'other', label: 'Outro' },
] as const

export const establishmentSchema = z.object({
  name: z.string().trim().min(2, 'O nome precisa ter pelo menos 2 caracteres.').max(80, 'O nome pode ter no máximo 80 caracteres.'),
  businessType: z.enum(['barbershop', 'salon', 'other']),
  phone: z
    .string()
    .trim()
    .max(30, 'Telefone muito longo.')
    .regex(/^[0-9()+\-\s]*$/, 'Use apenas números, espaços, parênteses, + e -.')
    .optional()
    .or(z.literal('')),
  timezone: z.enum(BRAZIL_TIMEZONES.map((t) => t.value) as [string, ...string[]]),
})

/** Primeiro erro por campo, pronto para exibir. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_')
    if (!(key in out)) out[key] = issue.message
  }
  return out
}
