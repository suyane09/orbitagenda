/** Converte erros técnicos em mensagens que dizem o que houve e o que fazer. */
interface ErrorLike { message?: string; code?: string; status?: number }

export function describeError(error: unknown, fallback = 'Não foi possível concluir. Tente novamente.'): string {
  const e = (error ?? {}) as ErrorLike
  const msg = (e.message ?? '').toLowerCase()
  const code = e.code ?? ''

  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos. Confira os dados ou redefina a senha.'
  if (msg.includes('email not confirmed')) return 'Seu e-mail ainda não foi confirmado. Abra a mensagem que enviamos e clique no link.'
  if (msg.includes('password should be at least') || code === 'weak_password') return 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.'
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.'
  }
  if (msg.includes('same password')) return 'A nova senha precisa ser diferente da atual.'
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
  if (msg.includes('establishment_limit_reached')) return 'Você atingiu o limite de 3 estabelecimentos por conta.'
  if (msg.includes('invalid_name')) return 'O nome do estabelecimento precisa ter entre 2 e 80 caracteres.'
  if (msg.includes('invalid_timezone')) return 'Fuso horário inválido. Escolha uma das opções da lista.'
  if (msg.includes('not_authenticated') || code === '28000') return 'Sua sessão expirou. Entre novamente.'
  if (code === '42501') return 'Você não tem permissão para fazer isso.'
  return fallback
}
