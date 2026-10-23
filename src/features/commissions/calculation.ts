/** Cálculo puro, em centavos. NÃO efetua repasses nem grava dados. */
export type CommissionRule =
 | { mode: 'none' }
 | { mode: 'percentage'; basisPoints: number }
 | { mode: 'fixed'; fixedCents: number }

const safeInt = (value: number, label: string): number => {
 if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} inválido`)
 return value
}

/**
 * Percentual: sobre recebimento líquido (recebimentos - estornos).
 * Fixo: proporcional ao pagamento líquido do serviço, com teto no fixo contratado.
 * Para calcular vários pagamentos, use total acumulado e subtraia a comissão
 * previamente reconhecida (evita arredondamento e duplicação por parcelas).
 */
export function accruedCommission(
 rule: CommissionRule,
 servicePriceCents: number,
 netReceivedCents: number
): number {
 const price = safeInt(servicePriceCents, 'Preço')
 const received = safeInt(netReceivedCents, 'Recebimento')
 const eligible = Math.min(price, received)
 if (rule.mode === 'none' || price === 0) return 0
 if (rule.mode === 'percentage') {
   const rate = safeInt(rule.basisPoints, 'Taxa')
   if (rate > 10000) throw new Error('Taxa maior que 100%')
   return Math.round(eligible * rate / 10000)
 }
 const fixed = safeInt(rule.fixedCents, 'Comissão fixa')
 return Math.round(Math.min(fixed, price) * eligible / price)
}
export function newCommissionAmount(
 rule: CommissionRule, servicePriceCents: number,
 netReceivedCents: number, alreadyAccruedCents: number
): number {
 const previous = safeInt(alreadyAccruedCents, 'Comissão anterior')
 return accruedCommission(rule, servicePriceCents, netReceivedCents) - previous
}
