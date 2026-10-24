# Integração Asaas — Orbit Agenda

## O que foi implementado

- Edge Function autenticada `asaas-subscribe`, com verificação do proprietário por membership, busca do valor do plano no banco (não aceita preço enviado pelo navegador) e criação de cliente + assinatura mensal no Asaas por Pix ou boleto.
- Cobranças criadas **somente depois de confirmação expressa** do proprietário.
- Proteção contra contratação duplicada: reserva atômica `asaas_provisioning_started_at`; uma falha inconclusiva bloqueia novas tentativas até reconciliação manual com o Asaas.
- IDs de cliente/assinatura vinculados ao estabelecimento, sem armazenar CPF/CNPJ localmente.
- Edge Function `asaas-webhook` com validação do cabeçalho `asaas-access-token`, reconsulta do pagamento via API do Asaas e persistência de eventos de forma idempotente no banco.
- Para `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` com status confirmado no Asaas, a assinatura volta a `active` se a cobrança paga não for anterior a outra cobrança ainda vencida. `PAYMENT_OVERDUE` confirmado registra `past_due` e o vencimento; após cinco dias completos de tolerância, o banco bloqueia operações de escrita. Eventos antigos e duplicados não devem reverter o estado de uma cobrança mais recente.
- RLS por estabelecimento nos eventos de pagamento; edição financeira e registro de pagamentos não são permitidos ao cliente.

## Estado atual de implantação

As Edge Functions estão publicadas no Supabase e há uma assinatura de teste vinculada ao Asaas **Sandbox** com pagamento registrado. A função `asaas-subscribe` exige JWT e a `asaas-webhook` valida um token próprio. A política de cinco dias e a reativação passaram por testes isolados, e o runner de Sandbox validou atraso, regularização e cancelamento com fixtures locais. **O ciclo completo via webhook real do Asaas Sandbox e o estorno integral concluído (REFUNDED/DONE) ainda não foram homologados.** Duas tentativas de devolução resultaram em CANCELLED, sem motivo técnico retornado. A produção não deve ser ativada antes dessa validação e da revisão de migrações. A flag `VITE_ASAAS_BILLING_ENABLED` controla a exibição da interface; conferir sua configuração na Vercel antes de oferecer o serviço.

## Configuração e homologação obrigatórias antes de cobrar em produção

Usar primeiro a conta [Asaas Sandbox](https://sandbox.asaas.com/). Documentação: https://docs.asaas.com/docs/sandbox.

1. Gerar chave exclusiva de API de **Sandbox** dentro da conta de testes do Asaas. Nunca colar tokens no GitHub, frontend ou nesta conversa.
2. Supabase > Edge Functions > Secrets: adicionar:
   - `ASAAS_API_KEY` — chave **Sandbox**.
   - `ASAAS_ENVIRONMENT` = `sandbox`.
   - `ASAAS_WEBHOOK_TOKEN` — token seguro e distinto da chave API, entre 32–255 caracteres.
   - `ASAAS_BILLING_ENABLED` = `false` inicialmente.
   - `ASAAS_PRODUCTION_CONFIRMED` = `false`. Necessário mudar para `true` **apenas depois** da homologação e autorização explícita para iniciar cobranças reais.
   - `ASAAS_ALLOWED_ORIGIN` = `https://orbitagenda.vercel.app`.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são segredos já fornecidos pela infraestrutura Supabase, verificar presença na versão utilizada.
3. Configurar no Asaas um webhook com endereço final:
   `https://peajkbjwusivdrqjoqtl.supabase.co/functions/v1/asaas-webhook`
   E inserir o **mesmo token** configurado em `ASAAS_WEBHOOK_TOKEN` no campo `authToken`. Selecionar eventos `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED` e demais eventos de cobrança necessários. Não usar a chave de API como token do webhook.
4. Verificar que `asaas-subscribe` está com `verify_jwt=true` e `asaas-webhook` com `verify_jwt=false`, pois a autenticação do webhook usa seu próprio token.
5. Com os segredos aplicados, validar conexão do webhook em Sandbox. Somente **depois** alterar `ASAAS_BILLING_ENABLED=true` para testar uma assinatura fictícia, preferencialmente em uma empresa de homologação. A geração de cobranças e envio de notificações do Asaas ocorre de verdade **no Sandbox**.
6. Conferir os eventos registrados, status contratual e logs no painel Asaas. Testar entrega repetida, pagamento recebido, pagamento pendente, estorno e entrega de webhook indisponível.
7. **Produção** exige chave de API própria de produção, `ASAAS_ENVIRONMENT=production`, webhook de produção configurado com token separado, aceite comercial de preço/termos, validação de nome e CPF/CNPJ, política de atrasos/cancelamentos, LGPD e comunicação aos clientes. Não reutilizar os clientes ou assinaturas do Sandbox em produção.

### Avisos importantes

- A integração não faz débito em cartão. O bloqueio por inadimplência é automático após cinco dias completos da data de vencimento, desde que o webhook tenha registrado a cobrança vencida; não há bloqueio baseado apenas em suposições de vencimento. **O tratamento de estornos, chargebacks e cobranças ausentes e a função de reconciliação estão implementados nesta branch, mas sua execução externa/operacional ainda exige homologação no Sandbox, agendamento e monitoramento.**
- Em uma falha de rede ou processamento depois da criação do cliente/assinatura no Asaas, **não repetir a tentativa automaticamente**. Revisar o Asaas, localizar os IDs gerados e conciliar com o registro antes de liberar outra contratação.
- Sem a chave e os tokens configurados, as funções devem **falhar fechadas** com `503`. Uma implantação de código não ativa cobrança real.
- Não executar `supabase db push` por causa do histórico de migrações antigas ainda divergente.
- Não cadastrar CPF/CNPJ de terceiros sem finalidade legítima e base legal; a integração envia o documento diretamente ao Asaas e não o armazena no banco do Orbit Agenda.

Fontes:
- https://docs.asaas.com/reference/criar-nova-assinatura
- https://docs.asaas.com/reference/criar-novo-cliente
- https://docs.asaas.com/docs/about-webhooks
- https://docs.asaas.com/docs/faq-de-webhooks
- https://supabase.com/docs/guides/functions/secrets

## Reconciliação automática (pendente de homologação no Sandbox)

A função `supabase/functions/asaas-reconcile` compara assinaturas e cobranças no Asaas com os dados locais. Processa no máximo 50 assinaturas por execução e usa os RPCs de faturamento para evitar duplicação de eventos. Assinatura inexistente no provedor e cobrança recente ausente geram divergências para revisão manual; a reconciliação **não cria cobranças**.

**Antes de ativar:** aplique as migrations `20261024120000_asaas_reversals_cancellations.sql` e `20261024130000_asaas_reconciliation.sql` em ambiente de homologação; configure `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_RECONCILE_TOKEN` (segredo aleatório com pelo menos 32 caracteres) e credenciais do Supabase; implante a função `asaas-reconcile` com `verify_jwt=false`; agende um POST diário autenticado exclusivamente pelo cabeçalho `x-reconcile-token`. Não registre o token em logs nem no repositório. O uso em produção exige revisão específica e `ASAAS_PRODUCTION_CONFIRMED=true`.

A reserva pública requer `TURNSTILE_SECRET_KEY` e `TURNSTILE_ALLOWED_HOSTNAMES` (lista de hostnames separados por vírgulas). Sem essa lista, o endpoint de reserva retorna 503 por segurança.

**Antes do merge/deploy:** confirmar execução dos testes SQL 97 e 98 e dos testes Vitest, revisar diferenças entre os RPCs e homologar webhook + reconciliação contra o Asaas Sandbox real. Não rodar `supabase db push` diretamente em produção. O PR não implanta nem migra o banco automaticamente.
