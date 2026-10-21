import { z } from 'zod'

export const NAME_MAX = 120
export const NOTES_MAX = 1000

/** Chave de comparação do telefone: só dígitos, sem o DDI 55 (igual ao índice único do banco). */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return /^55\d{10,11}$/.test(d) ? d.slice(2) : d
}

const foreign = (raw: string) => /^\s*\+(?!\s*55)/.test(raw)

/** (79) 99999-0000 quando for número brasileiro reconhecível; senão, o texto original. */
export function formatPhone(raw: string | null): string {
  if (!raw) return ''
  if (foreign(raw)) return raw
  const k = phoneKey(raw)
  if (k.length === 11) return `(${k.slice(0, 2)}) ${k.slice(2, 7)}-${k.slice(7)}`
  if (k.length === 10) return `(${k.slice(0, 2)}) ${k.slice(2, 6)}-${k.slice(6)}`
  return raw
}

/** Link do WhatsApp (só números brasileiros reconhecíveis). */
export function whatsappUrl(raw: string | null): string | null {
  if (!raw || foreign(raw)) return null
  const k = phoneKey(raw)
  return k.length === 10 || k.length === 11 ? `https://wa.me/55${k}` : null
}

/** Minúsculas e sem acentos, para busca. */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')

export const customerSchema = z.object({
  fullName: z.string().trim().min(2, 'O nome precisa ter pelo menos 2 caracteres.').max(NAME_MAX, `O nome pode ter no máximo ${NAME_MAX} caracteres.`),
  phone: z.string().trim()
    .refine((v) => v === '' || /^[0-9()+\-.\s]+$/.test(v), 'Use apenas números, espaços, parênteses, + e -.')
    .refine((v) => v === '' || (phoneKey(v).length >= 8 && phoneKey(v).length <= 13), 'Informe o telefone com DDD, por exemplo (79) 99999-0000.'),
  email: z.string().trim().max(254, 'E-mail muito longo.')
    .refine((v) => v === '' || z.email().safeParse(v).success, 'Informe um e-mail válido.'),
  notes: z.string().trim().max(NOTES_MAX, `As observações podem ter no máximo ${NOTES_MAX} caracteres.`),
})
export type CustomerForm = z.input<typeof customerSchema>

export interface DupCandidate { id: string; full_name: string; phone: string | null; email: string | null }

/** Cliente já cadastrado com o mesmo telefone ou e-mail (aviso antes de enviar; o banco é a garantia final). */
export function findDuplicate(list: readonly DupCandidate[], v: { phone: string; email: string }, ignoreId: string | null): { customer: DupCandidate; by: 'phone' | 'email' } | null {
  const pk = v.phone ? phoneKey(v.phone) : ''
  const em = v.email.trim().toLowerCase()
  for (const c of list) {
    if (c.id === ignoreId) continue
    if (pk && c.phone && phoneKey(c.phone) === pk) return { customer: c, by: 'phone' }
    if (em && c.email && c.email.toLowerCase() === em) return { customer: c, by: 'email' }
  }
  return null
}

export const APPOINTMENT_STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'muted' | 'danger' }> = {
  scheduled: { label: 'Agendado', tone: 'info' },
  confirmed: { label: 'Confirmado', tone: 'info' },
  completed: { label: 'Concluído', tone: 'ok' },
  cancelled: { label: 'Cancelado', tone: 'muted' },
  no_show: { label: 'Não compareceu', tone: 'danger' },
}
