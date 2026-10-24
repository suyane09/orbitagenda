# OrbitAgenda — validação de cobrança (24/10/2026)

## Alterações aplicadas

- Supabase: tolerância de **cinco dias completos após o vencimento** (ex.: vencimento 20/10; acesso de escrita até 25/10; bloqueio em 26/10 no horário de São Paulo).
- Supabase: bloqueio de INSERT/UPDATE/DELETE por 45 políticas RLS restritivas em 15 tabelas; SELECT preservado para membros autorizados.
- Supabase: `create_public_booking` consulta a regra de cobrança explicitamente, pois a Edge Function de reserva utiliza `service_role` e contorna RLS.
- Supabase: `record_asaas_billing_event` exige data de vencimento verificada, grava eventos idempotentemente e usa `last_paid_due_date` para evitar que eventos atrasados de cobranças antigas alterem o estado de cobranças mais recentes.
- Supabase: suspensão administrativa não é removida por um evento de pagamento nem convertida em `past_due` por um evento antigo.
- Supabase: `is_establishment_billing_blocked(uuid)`, função SECURITY INVOKER acessível apenas a usuários autenticados e membros do estabelecimento.
- Frontend: guarda consulta a decisão do servidor, inclusive para funcionários, e mantém a página de assinatura acessível.
- Edge Function `public-booking` v17: resposta HTTP 403 `subscription_suspended` em vez de erro 500; frontend exibe mensagem compreensível.
- Migração versionada: `supabase/migrations/20261024020000_billing_grace_and_event_order.sql`.

## Testes de banco executados com dados isolados e rollback

Todos os cenários abaixo foram executados em blocos transacionais que **reverteram todas as inserções de teste**:

1. Assinatura ativa permite escrita.
2. Fatura vencida há seis dias bloqueia escrita.
3. Fatura vencida há cinco dias ainda permite escrita.
4. RPC de agendamento público rejeita estabelecimento bloqueado antes de tentar criar reserva.
5. Pagamento confirmado reativa assinatura e limpa vencimento pendente.
6. Evento de atraso de fatura já paga não volta a bloquear o estabelecimento.
7. Atraso de uma fatura mais nova prevalece sobre pagamento tardio de uma fatura antiga.
8. Pagamento da fatura mais nova restaura acesso.
9. Evento com o mesmo ID é idempotente.
10. RLS com papel real `authenticated` e usuário membro: leitura permitida, INSERT negado e UPDATE sem alteração enquanto bloqueado; INSERT permitido após regularização.
11. RPC de consulta de bloqueio: membro ativo autorizado, membro inadimplente bloqueado, usuário de outro estabelecimento recebe erro 42501, regularização libera.
12. Suspensão administrativa permanece ativa mesmo após eventos de pagamento/atraso.

Pós-testes: **0** estabelecimentos, eventos e assinaturas fictícias remanescentes. A assinatura existente da **Barbearia Teste Orbit** permaneceu `active`, `payment_due_at=null`, escrita permitida e ambiente `sandbox`.

## Verificações de implantação

- Supabase `public-booking` versão **17**, estado `ACTIVE`, `verify_jwt=false` (a função valida chave publicável e Turnstile no próprio código).
- GitHub/Vercel: status de implantação `success` para o commit `2165b347143d52289269d24f7f16733fe777a9f2`. Isso **não** comprova teste de navegador ou fluxo real.
- Supabase: 45 políticas RLS de cobrança presentes; função de consulta é SECURITY INVOKER; nenhuma linha de QA persistiu.
- Revisão do advisor Supabase: alertas para SECURITY DEFINER existentes em outras RPCs e proteção de senhas vazadas desativada. A nova RPC foi convertida para SECURITY INVOKER.

## Pendente antes de comercializar como 100% homologado

1. Teste real no **Asaas Sandbox**: gerar nova fatura de teste, simular atraso, confirmar webhook, reprocessar evento duplicado e confirmar pagamento posterior com restauração. **Não executado nesta rodada**.
2. Testar webhook sob falha de rede, reenvio e entrega fora de ordem contra a API real do Asaas. Os testes de ordenação executados foram no banco, não na rede.
3. Testar public booking ponta a ponta no navegador com Turnstile válido e um estabelecimento fictício controlado, incluindo reserva e bloqueio; a regra do banco foi testada.
4. Validar configurações atuais de Vercel e Asaas para produção, além de rotinas de reconciliação de pagamentos ausentes e estornos/chargebacks.
5. Avaliar avisos de segurança do Supabase e cobertura de regressão de todos os módulos do SaaS.

**Conclusão:** política de cobrança, proteção de escrita, isolamento de leitura e lógica de reativação passaram nos testes transacionais; **não afirmar homologação end-to-end do Asaas nem conclusão de 100% do SaaS**.
