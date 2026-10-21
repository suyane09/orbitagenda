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
  if (msg.includes('services_establishment_name_uq')) return 'Já existe um serviço com esse nome. Escolha outro nome.'
  const conflicts = /block_conflicts_appointments:(\d+)/.exec(msg)
  if (conflicts) {
    const n = Number(conflicts[1])
    return `Há ${n} ${n === 1 ? 'agendamento ativo' : 'agendamentos ativos'} nesse período. Remarque ou cancele ${n === 1 ? 'o atendimento' : 'os atendimentos'} antes de bloquear.`
  }
  if (msg.includes('working_hours_overlap')) return 'Há trechos de horário sobrepostos no mesmo dia. Revise o expediente e os intervalos.'
  if (msg.includes('block_overlap') || (code === '23P01' && !msg.includes('appointments_no_overlap'))) return 'Já existe uma folga, férias ou bloqueio nesse período para o mesmo escopo. Edite o existente ou escolha outras datas.'
  if (msg.includes('block_in_the_past')) return 'O período não pode estar inteiramente no passado.'
  if (msg.includes('vacation_requires_professional')) return 'Férias pertencem a um profissional. Escolha quem vai sair.'
  if (msg.includes('range_too_long')) return 'O período pode ter no máximo 366 dias.'
  if (msg.includes('invalid_range')) return 'Período inválido. A data/hora final precisa ser depois da inicial.'
  if (msg.includes('invalid_time')) return 'Horário inválido. Use horas e minutos cheios (ex.: 09:30).'
  if (msg.includes('too_many_segments')) return 'Há trechos demais no expediente. Reduza o número de intervalos.'
  if (msg.includes('block_not_found')) return 'Registro não encontrado. Atualize a página e tente de novo.'
  if (msg.includes('customers_phone_uq')) return 'Já existe um cliente com este telefone neste estabelecimento.'
  if (msg.includes('customers_email_uq')) return 'Já existe um cliente com este e-mail neste estabelecimento.'
  if (msg.includes('customers_email_format')) return 'Informe um e-mail válido.'
  if (msg.includes('customers_phone_digits')) return 'Informe o telefone com DDD, por exemplo (79) 99999-0000.'
  if (code === '23503' && msg.includes('update or delete on table')) return 'Este item já tem agendamentos vinculados e não pode ser excluído. Desative-o para tirá-lo de uso.'
  if (code === '23503') return 'Algum item selecionado não pertence a este estabelecimento. Atualize a página e tente de novo.'
  if (code === '23514') return 'Algum valor está fora do permitido. Revise os campos e tente de novo.'
  if (code === '23505') return 'Já existe um registro igual a este.'
  if (code === 'P0002' || msg.includes('professional_not_found')) return 'Registro não encontrado. Atualize a página e tente de novo.'
  if (msg.includes('too_many_services')) return 'Selecione no máximo 100 serviços.'
  if (code === '42501') return 'Você não tem permissão para fazer isso.'
  return fallback
}
