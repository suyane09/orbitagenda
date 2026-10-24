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

- **Teste HTTP tentado:** uma requisição POST sem token para verificar resposta 401 não chegou ao Supabase: o ambiente de execução não conseguiu resolver o domínio do projeto (`curl: (6) Could not resolve host`). Portanto, **nenhum smoke test HTTP foi validado** nesta rodada; essa limitação não representa falha comprovada do serviço.


## Auditoria adicional — 24/10/2026, 01:49–01:55 (America/Fortaleza)

- **Falha real identificada na guarda de cobrança:** `private.billing_allows_write` só bloqueava `suspended` e `past_due` vencido. Uma assinatura `canceled` sem período pago vigente ainda permitia INSERT/UPDATE/DELETE; uma assinatura Asaas `past_due` com `payment_due_at=null` também permitia escrita indefinidamente.
- **Correção aplicada no Supabase:** `canceled` bloqueia quando `current_period_end` é nulo ou já passou; `canceled` com período pago futuro mantém acesso até o fim do período; `past_due` vinculada ao Asaas sem vencimento conhecido bloqueia por segurança. A tolerância de cinco dias completos continua inalterada.
- **Migração versionada:** `supabase/migrations/20261024045200_billing_cancelled_and_missing_due_date_guard.sql`, commit `3fa3da8728d3881217fbe9cea83fe6f6d5ed58bc`.
- **Nove verificações SQL de comportamento aprovadas:** (1) active permite; (2) canceled sem fim bloqueia; (3) canceled com período futuro permite; (4) canceled com período expirado bloqueia; (5) past_due sem vencimento bloqueia; (6) past_due há 4 dias permite; (7) past_due há 6 dias bloqueia; (8) suspended bloqueia; (9) reativação active permite. Executadas em estabelecimento fictício dentro de bloco PL/pgSQL com subtransação e rollback intencional; erro de constraint no primeiro preparo foi corrigido no próprio fixture e a rodada seguinte concluiu as nove asserções.
- **Integridade comprovada:** zero estabelecimentos e zero assinaturas do fixture após rollback; permanece uma assinatura sandbox ativa. Não foram alterados dados de cobrança reais.
- **Nova evidência de rede obtida pelos logs Supabase:** houve uma requisição HTTP `POST /functions/v1/asaas-webhook` do user-agent `Asaas_Hmlg/3.0` com HTTP 200 em **24/10/2026 00:34:38 UTC**, mas era a implantação **v11** (anterior às correções recentes). A tabela `asaas_payment_events` registra `PAYMENT_RECEIVED` / `RECEIVED` no sandbox nesse mesmo instante. Houve também quatro tentativas HTTP 401 na implantação v10. **Nenhuma chamada HTTP à versão v15 foi encontrada no intervalo consultado.** Portanto, há evidência de integração real anterior, mas **não** homologação ponta a ponta da versão atual.
- **Pendências mantidas:** Asaas Sandbox deve enviar evento real de atraso, pagamento e reenvio à versão atual do webhook; falta teste de navegador com Turnstile; definir tratamento de `PAYMENT_REFUNDED`, chargeback e cancelamento; validar integração em produção e reconciliação periódica.

- **Duas verificações adicionais da RPC de agendamento público aprovadas:** com assinatura `canceled` sem período pago e com assinatura Asaas `past_due` sem vencimento, `create_public_booking` rejeitou a reserva com SQLSTATE `42501` e mensagem `subscription_suspended` antes de consultar serviço ou criar cliente. Ambos os fixtures foram revertidos; verificação final confirmou zero estabelecimentos e zero assinaturas fictícias remanescentes e uma assinatura sandbox ativa. **Total desta rodada: 11 asserções SQL aprovadas** (9 guarda + 2 agendamento público), sem teste HTTP/Turnstile nesta rodada.


## Auditoria adicional — 24/10/2026, 02:50–03:00 (America/Fortaleza)

- **Falha comprovada antes da correção:** `private.billing_allows_write(uuid)` devolvia `true` quando não existia registro em `establishment_subscriptions` (confirmado com UUID inexistente). A RPC `create_establishment` cria estabelecimento e vínculo de proprietário, **mas não cria a assinatura**. Assim, um novo estabelecimento sem plano podia criar dados e aceitar reservas apesar de não ter cobrança configurada.
- **Correção aplicada no Supabase:** a guarda agora exige um registro de assinatura para liberar escrita; sem registro, bloqueia por padrão. A mesma regra já é consumida pelas 45 políticas RLS e pela RPC `create_public_booking`, sem alterar suas assinaturas ou políticas. Migração versionada: `supabase/migrations/20261024055000_billing_fail_closed_missing_subscription.sql` (commit `f76ed3b36a8adc4e1be0d70cc6662910fe309d3e`).
- **Outros estados sem prazo fechados:** `trialing` sem `current_period_end` ou com prazo expirado agora bloqueia; `past_due` administrativo sem vínculo Asaas bloqueia; `past_due` Asaas sem data verificada também bloqueia. Mantidos os cinco dias completos de tolerância para `past_due` Asaas com data conhecida. Migração: `supabase/migrations/20261024055800_billing_unbounded_trial_and_manual_overdue.sql` (commit `2a38e1cc99a5559dfd1f25c5f02fb21677c5dd10`).
- **18 asserções SQL passaram**, executadas com estabelecimento fictício em subtransação revertida: ausência de assinatura; novo estabelecimento sem plano; RPC de reserva pública sem plano rejeitada com `42501/subscription_suspended`; teste sem fim; teste expirado; teste vigente; assinatura ativa; atraso manual; atraso Asaas sem vencimento; atraso de 4, 5 e 6 dias; reativação após mudança para `active`; suspensão; cancelamento sem período; cancelamento com período futuro; cancelamento com período vencido; rollback completo do fixture. A primeira tentativa de fixture, antes do ajuste de `started_at`, falhou por uma constraint legítima (`subscription_period_after_start`); a execução corrigida passou.
- **Integridade pós-teste:** permanece **1 estabelecimento**, nenhum `qa-%` e uma assinatura existente com `status=active`, `asaas_environment=sandbox`, `payment_due_at=null`, `billing_allows_write=true`. Não houve alterações de cobrança ou de estabelecimento ativo.
- **Dependência de onboarding:** os planos existentes (`piloto` e `inicial_4990`) estão com `is_public=false`; `asaas-subscribe` exige assinatura/plano previamente atribuído por administrador. Com o novo bloqueio, o estabelecimento recém-criado **não pode usar o sistema até o administrador atribuir uma assinatura válida**. Isso impede uso gratuito involuntário, mas o fluxo de ativação/autosserviço precisa ser projetado/testado antes de vender onboarding totalmente automático.
- **Não testado nesta rodada:** notificações HTTP reais do Asaas Sandbox para a versão 15, pagamentos/estornos, browser/Turnstile, reconciliação automática e ativação completa de novos estabelecimentos. Não declarar homologação ponta a ponta.

## Auditoria adicional — 24/10/2026, 03:45–04:00 (America/Fortaleza)

- **Falha de segurança identificada:** as 45 políticas RLS restritivas de cobrança não cobrem automaticamente funções `SECURITY DEFINER` que escrevem como proprietário do banco. Seis RPCs de operações do estabelecimento executavam mutações sem consultar a assinatura: `close_cash_day`, `reopen_cash_day`, `record_commission_payout`, `create_team_invitation`, `accept_team_invitation` e `revoke_team_invitation`. Assim, o bloqueio por inadimplência não estava completo para essas operações.
- **Correção aplicada no Supabase:** após as respectivas verificações de autorização, cada uma dessas seis RPCs consulta `private.billing_allows_write(establishment_id)` e retorna SQLSTATE `42501` / `subscription_suspended` antes de alterar dados quando o estabelecimento não tem acesso. As verificações de proprietário, token e usuário permanecem intactas.
- **Migração versionada:** `supabase/migrations/20261024065000_billing_security_definer_guards.sql`, commit `c2c910b1f147a5f20b928cacb206aac2e545a1b6`. A migração foi aplicada com sucesso no Supabase e as seis definições implantadas foram relidas para confirmar a presença do bloqueio.
- **11 asserções SQL executadas com fixtures revertidos:** ausência de assinatura bloqueia; fechamento de caixa bloqueado; convite de equipe bloqueado; pagamento de comissão bloqueado; aceite de convite bloqueado; revogação de convite bloqueada; reabertura de caixa bloqueada; assinatura ativa permite escrita; convite permitido durante assinatura ativa; suspensão impede escrita; convite negado após suspensão. As operações de teste foram encapsuladas em subtransações e revertidas deliberadamente. **Não são testes HTTP nem testes de cobrança real.**
- **Integridade após rollback:** 1 estabelecimento existente, 0 estabelecimentos `QA`, 1 assinatura existente, 0 convites, 1 fechamento de caixa já existente e 1 evento Asaas. A assinatura sandbox existente segue ativa, sem vencimento pendente e com escrita liberada. Nenhuma cobrança real foi criada ou alterada.
- **Limites remanescentes:** o Asaas Sandbox não foi acionado nesta rodada; continuam pendentes webhook real na versão 15, reembolso/chargeback, reconciliação de pagamentos, fluxo de ativação de novo estabelecimento e teste no navegador com Turnstile. A auditoria desta rodada cobre seis RPCs SECURITY DEFINER de escrita; outras rotas e integrações ainda requerem regressão completa.
