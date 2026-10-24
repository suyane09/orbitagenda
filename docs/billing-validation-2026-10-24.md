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


## Verificação adicional — 24/10/2026, madrugada

- **Falha identificada:** o webhook encaminhava qualquer evento `PAYMENT_*` ao RPC, embora o RPC aceite apenas `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED` e `PAYMENT_OVERDUE`. Eventos como `PAYMENT_CREATED` provocariam resposta 503 e reenvios desnecessários.
- **Correção aplicada:** somente esses três eventos de cobrança são encaminhados; outros recebem HTTP 200 `ignored`. Isso não significa que estornos ou chargebacks estejam tratados — **a política para eles permanece pendente**.
- **Falha identificada:** um `PAYMENT_OVERDUE` atrasado podia chegar após o pagamento ter sido recebido. Embora o banco já tenha proteção de ordenação, o webhook não reconciliava o nome do evento com o status atual retornado pela API Asaas.
- **Correção aplicada:** para os três eventos aceitos, o webhook busca o pagamento na API Asaas e usa o **status atual verificado** (`RECEIVED`, `CONFIRMED` ou `OVERDUE`) para determinar o evento efetivo; outros estados atuais são ignorados.
- **Publicação comprovada:** commit GitHub `8e6b275c41cceba8ea0044e311c2facca75683b4`; Edge Function `asaas-webhook` versão **14**, status `ACTIVE`, com ambas as alterações confirmadas por leitura da versão implantada.
- **Integridade pós-publicação:** única assinatura existente permaneceu `active`, ambiente `sandbox`, `payment_due_at=null`, `last_paid_due_date=null`, `private.billing_allows_write(...)=true`. Nenhuma cobrança foi gerada nem alterada.
- **Limite do teste:** a implantação e o código publicado foram verificados, mas não houve disparo de evento real Asaas Sandbox nem teste HTTP completo nesta rodada. O evento de estorno, o cancelamento da assinatura e a reconciliação periódica continuam pendentes.

## Revisão adicional — 24/10/2026, correção de regressão no webhook

- **Regressão real encontrada no código da versão 14:** onze sequências literais `\\n` haviam sido inseridas onde deveriam existir quebras de linha no TypeScript. Como algumas estavam em comentários `//`, trechos que deveriam filtrar eventos e declarar `verifiedEvent` ficavam comentados. Isso podia levar a erro em tempo de execução na etapa de gravação do webhook. A publicação anterior, sozinha, não comprovava execução correta.
- **Correção aplicada:** substituição das onze sequências por quebras de linha reais, preservando o restante da implementação; commit GitHub `1723f843170831efa78d2f3e7bc76132343a1b5a`.
- **Implantação comprovada:** função `asaas-webhook` versão **15**, status `ACTIVE`; leitura posterior do código implantado confirmou ausência dessas sequências literais, presença do filtro de eventos e da variável `verifiedEvent`.
- **Checagens de banco somente leitura:** 45 políticas restritivas de escrita continuam presentes; a RPC `record_asaas_billing_event` não pode ser executada por `anon` nem `authenticated`, mas pode por `service_role`. Para vencimento em 20/10, o cálculo retorna **acesso em 25/10** e **bloqueio em 26/10**.
- **Integridade:** a única assinatura consultada permanece `active`, `payment_due_at=null`, ambiente `sandbox` e `billing_allows_write=true`; a tabela de eventos contém uma linha. Nenhuma cobrança ou assinatura foi modificada nesta rodada.
- **Limite importante:** a leitura da função publicada e as verificações SQL **não** equivalem a uma requisição HTTP de webhook Asaas Sandbox. Ainda faltam eventos reais de atraso, pagamento, duplicação e fora de ordem, e testes de navegador com Turnstile.
- **Advisor Supabase:** permanecem avisos sobre dez RPCs `SECURITY DEFINER` executáveis por autenticados, além da proteção contra senhas vazadas desativada. Não foram alteradas sem revisão das autorizações esperadas.
