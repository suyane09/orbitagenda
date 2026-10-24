# Homologação Asaas Sandbox — OrbitAgenda

> **Não executar contra produção.** O endereço `orbitagenda.vercel.app` e o webhook `peajkbjwusivdrqjoqtl.supabase.co` são ambientes existentes, não alvos deste roteiro.

## Pré-requisitos

- Supabase CLI local em `http://127.0.0.1:54321`, com migrações locais aplicadas.
- Edge Functions locais servidas com `npx supabase functions serve --env-file .env.local --no-verify-jwt`.
- Variáveis **servidor** em `.env.local`: `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_RECONCILE_TOKEN`, `ASAAS_BILLING_ENABLED=true`, `ASAAS_ALLOWED_ORIGIN=http://localhost:5173`. Cada token de webhook/conciliação precisa ter no mínimo 32 caracteres.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são injetados pela CLI no runtime local. Variáveis `VITE_*` destinam-se apenas ao navegador e não substituem variáveis do servidor.
- **Atenção:** `vercel link` pode modificar `.env.local`. Conferir os nomes e os ambientes antes de rodar testes. Nunca imprimir tokens ou fazer commit do arquivo.

## 1. Testar o webhook isolado sem movimentar pagamentos

Em um PowerShell com `$env:ASAAS_WEBHOOK_TOKEN` definido localmente:

```powershell
$endpoint = "http://127.0.0.1:54321/functions/v1/asaas-webhook"
$headers = @{ "asaas-access-token" = $env:ASAAS_WEBHOOK_TOKEN; "Content-Type" = "application/json" }
$payload = @{ id = "evt_sandbox_invalid_id_001"; event = "PAYMENT_RECEIVED"; payment = @{ id = "teste-invalido" } } | ConvertTo-Json -Depth 5
try {
  Invoke-WebRequest -Uri $endpoint -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -UseBasicParsing
} catch {
  Write-Host "HTTP:" ([int]$_.Exception.Response.StatusCode)
}
```

Esperado após a correção proposta na PR #16: **404 `asaas_payment_not_found`**, caso a API Asaas retorne 404 para o ID inexistente. Se houver timeout ou erro upstream, será 502 e exige diagnóstico. Este teste não valida conectividade sozinho.

## 2. Criar uma assinatura verdadeira

1. Entrar no OrbitAgenda local com um **usuário de teste do Supabase local** e selecionar um estabelecimento local cujo usuário seja `owner`.
2. Verificar se há registro em `establishment_subscriptions` com `plan_id` válido, `status` em `trialing`, `active` ou `past_due`, sem `asaas_subscription_id` nem `asaas_provisioning_started_at`.
3. Abrir a página Plano e assinatura no frontend **local**, com `ASAAS_ALLOWED_ORIGIN` configurada para a origem local.
4. Autorizar contratação com CPF/CNPJ de teste e PIX/BOLETO. A função `asaas-subscribe` deve criar `cus_*` e `sub_*` no Sandbox e gravar o vínculo local. **Não repetir a operação em caso de 502**: a reserva bloqueia retentativas para evitar duplicação.
5. Verificar `asaas_subscription_id`, `asaas_environment='sandbox'` e `asaas_customer_id` no Supabase Studio local. Nunca criar o vínculo manualmente com IDs de terceiros.

## 3. Testar pagamento, atraso e conciliação

- No painel **Asaas Sandbox**, localizar a assinatura `sub_*` e o pagamento `pay_*` gerado para ela.
- Usar exclusivamente as ações de simulação oferecidas pelo Sandbox para alterar o status do pagamento; não falsificar eventos como substituto da alteração no provedor.
- Para entrega de webhooks real, criar **outro webhook exclusivo do Sandbox**, com URL pública temporária apontando à função local por túnel seguro, e token igual ao `ASAAS_WEBHOOK_TOKEN`. **Não editar nem reaproveitar** o webhook existente que aponta para o Supabase online.
- Confirmar o processamento de `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE` e `PAYMENT_REFUNDED` conforme o estado real da API Asaas. A função consulta o pagamento no provedor e ignora eventos incompatíveis.
- Executar `asaas-reconcile` localmente com `x-reconcile-token` e conferir o relatório `checked/applied/errors/divergences`. Testar idempotência repetindo o mesmo evento sem duplicar efeitos.

## Critérios para encerrar

- Assinatura `sub_*` ligada ao estabelecimento local;
- Pagamento real de Sandbox confirmado e registrado uma única vez;
- Atraso e regularização simulados e refletidos corretamente;
- Reversão e conciliação verificadas;
- Nenhuma alteração no banco, webhook ou configuração de produção.

**Estado atual:** etapas de autenticação do webhook e build/testes locais foram realizadas anteriormente; os critérios de pagamento/atraso acima ainda exigem execução e evidências no Sandbox local.

## 4. Retomar estorno PIX solicitado que ficou pendente

No teste local de 2026-10-24, `overdue` e `cancel` passaram; o pedido `POST /payments/{id}/refund` da fixture de estorno foi aceito pelo Asaas, mas a cobranca nao retornou `REFUNDED` no periodo curto de consulta. **Isto nao confirma nem refuta o estorno final.**

O Asaas distingue `PAYMENT_REFUND_IN_PROGRESS` (em processamento) de `PAYMENT_REFUNDED` (concluido). Em `payment.refunds[]`, `status=PENDING` significa solicitado, enquanto `status=DONE` significa concluido: https://docs.asaas.com/docs/payment-events e https://docs.asaas.com/docs/refunds .

**Nao execute `--execute` novamente apenas para verificar o estorno**: isto criaria mais assinaturas e poderia solicitar outro estorno. Use a retomada que identifica a fixture local isolada `Orbit Teste Estorno`, consulta o pagamento e seus estornos e **nao chama novamente o endpoint de estorno**.

Atualize o script e consulte, estando no diretorio `orbitagenda-homologacao`:

```powershell
$ErrorActionPreference = "Stop"; New-Item -ItemType Directory -Path ".\scripts" -Force | Out-Null; Invoke-WebRequest -Uri "https://raw.githubusercontent.com/suyane09/orbitagenda/fix/asaas-reconciliation-overdue-order-20261024/scripts/asaas-sandbox-e2e.mjs" -OutFile ".\scripts\asaas-sandbox-e2e.mjs" -UseBasicParsing -ErrorAction Stop; node ".\scripts\asaas-sandbox-e2e.mjs" --resume-refund
```

Se a consulta retornar `refunds[].status=AWAITING_CRITICAL_ACTION_AUTHORIZATION`, o Asaas esta aguardando a **autorizacao de uma acao critica**; nao e um atraso de polling. Entre em https://sandbox.asaas.com, localize a cobranca de teste e conclua a autorizacao solicitada pelo proprio Asaas. No Sandbox, o codigo de teste documentado para validacoes de token e `000000` **somente quando solicitado pela interface** (https://docs.asaas.com/docs/como-testar-a%C3%A7%C3%B5es-cr%C3%ADticas). O script para imediatamente neste estado e nao repete o pedido de devolucao.

Se ainda estiver `REFUND_IN_PROGRESS` ou `refunds[].status=PENDING`, o resultado sera **PENDENTE/INCONCLUSIVO**, nao falha da regra de acesso. O script nao alterara estado financeiro do provedor e podera ser consultado novamente. **Somente quando o Asaas confirmar `REFUNDED`** ele chamara a conciliacao local e verificara `past_due`, carencia de cinco dias e bloqueio apos o prazo em registro descartavel.

Nao publicar nem mesclar as PRs de cobranca ate registrar evidencia de estorno concluido e confirmar que todas as etapas de homologacao exigidas passaram.

## 5. Alternativa se o Asaas deixar um estorno via API preso em autorizacao critica

O painel mostra duas opcoes diferentes: a funcionalidade **"Estornar cobranca" dentro de "Acoes de Sandbox"** e a funcionalidade financeira normal **"Solicitar estorno"**. Quando o pedido normal esta em `AWAITING_CRITICAL_ACTION_AUTHORIZATION`, nao gere outro estorno **naquela cobranca**, nem desative a protecao da conta.

Para validar a transicao real `REFUNDED` no Sandbox sem depender desse pedido, o script oferece um segundo fluxo isolado, que prepara uma nova cobranca de homologacao R$ 49,90 vinculada ao Docker LOCAL:

```powershell
node .\scripts\asaas-sandbox-e2e.mjs --prepare-refund-sim
```

Depois, na interface do **Asaas Sandbox**, localize exatamente a descricao **TESTE ISOLADO OrbitAgenda Estorno UI Sandbox** e confira o ID `pay_...` mostrado no terminal. Clique **apenas em "Estornar cobranca" no quadro laranja "Acoes de Sandbox"**. A opcao "Solicitar estorno" e o fluxo financeiro normal e nao deve ser usada nesse cenario. O botao de simulacao aparece no screenshot do painel, mas **ainda precisa ser validado no ambiente desta conta**; nao ha garantia antecipada de que dara status `REFUNDED`.

Para consultar a mudanca de status, auditar webhooks e validar os bloqueios sem criar novas operacoes no Asaas:

```powershell
node .\scripts\asaas-sandbox-e2e.mjs --check-refund-sim
```

O preparo reutiliza a propria fixture se repetido. A verificacao nao cria nenhuma fixture nem solicita nenhum estorno. **Nao e teste de autorizacao de acao critica em producao**: e um teste de recepcao do estado final, webhook, conciliacao e bloqueio no ambiente Sandbox.

## 6. Resultado real da simulação de estorno no Sandbox (24/10/2026)

Fixture descartável: assinatura `sub_tetr2mo4f95c0x7y`, cobrança `pay_0jx1hsuu620kubkw`, R$ 49,90. O painel mostrou **"Valor parcialmente estornado"**, enquanto a API retornou **`payment.status=RECEIVED` e `refunds=[{status:"CANCELLED",value:49.9}]`**.

**Isto não é estorno concluído.** Segundo https://docs.asaas.com/docs/estornos, apenas `refunds[].status=DONE` confirma valor devolvido; `CANCELLED` significa que a devolução foi cancelada. A mensagem visual do painel não prevalece sobre a conciliação dos estados. Nesse caso o contrato deve permanecer `active` até confirmação verdadeira do Asaas. **Não repetir estorno na mesma cobrança.**

Foi criado diagnóstico negativo em `--check-refund-sim`: ele reconsulta o estado, chama apenas a conciliação local, exige `active` e escrita liberada, e sinaliza **teste negativo aprovado / estorno financeiro integral NÃO homologado** com código de saída 4, para não dar falso verde.

A suíte automatizada de SQL já valida processamento do evento `PAYMENT_REFUNDED` e as alterações `active -> past_due`, tolerância de cinco dias e bloqueio. Isso é teste de regra, **não substitui** a evidência de um estorno financeiro concluído no Sandbox.

A solicitação anterior em `pay_41pnfrerqc0b4qv5` segue um fluxo separado de **`AWAITING_CRITICAL_ACTION_AUTHORIZATION`**, sem confirmação de conclusão. Ela não deve ser repetida.

## 7. Auditoria remota de código e segurança (24/10/2026)

Executado sem acesso ao Asaas Sandbox nem ao Docker do operador:

- **Gateway Supabase:** `[functions.asaas-webhook]` e `[functions.asaas-reconcile]` exigem `verify_jwt=false`, pois usam respectivamente os próprios cabeçalhos secretos `asaas-access-token` e `x-reconcile-token`. A validação desses segredos acontece na Edge Function. `[functions.asaas-subscribe]` mantém `verify_jwt=true`, além de validar a sessão e propriedade da empresa.
- **Produção protegida:** as três funções financeiras exigem `ASAAS_PRODUCTION_CONFIRMED=true` quando configuradas para `ASAAS_ENVIRONMENT=production`. Nenhuma configuração ou banco de produção foi alterado nesta homologação.
- **Dia de vencimento:** a data da assinatura e o dia da conciliação utilizam o calendário de `America/Sao_Paulo` pelo `Intl.DateTimeFormat`, evitando a data errada perto da meia-noite UTC e quando havia horário de verão.
- **Consulta financeira:** listagens do Asaas que retornarem 404, dados malformados, cobrança atribuída a outra assinatura, quantidade além do limite por execução ou identificador de assinatura divergente causam falha auditável sem registrar sincronização concluída. `EXPIRED`/status de assinatura desconhecido gera divergência e exige revisão, **não** cancela automaticamente.
- **Validação GitHub:** testes Vitest (segurança, regras financeiras), PostgreSQL em banco descartável, build TypeScript/Vite e smoke tests no Chromium. Configuração de gateway e funções compartilhadas também ativam CI.
- **Limite de escopo:** estes testes simulam comportamentos e exercitam SQL e navegador, mas **não substituem** o teste real de estorno integral concluído com `PAYMENT_REFUNDED` na conta Asaas Sandbox. Os testes negativos já comprovaram que reembolso `CANCELLED` não deve suspender o serviço.

Antes de qualquer release, a integração requer revisão de deploy, segredos, configuração de webhooks, agendamento real da conciliação e evidência de estorno integral `DONE`, sem afetar a produção atual. As PRs #15, #16 e #17 permanecem separadas e dependentes.

## 8. Duas tentativas de estorno efetivamente CANCELLED (24/10/2026)

Nova leitura da fixture original confirmou: pagamento `pay_41pnfrerqc0b4qv5`, assinatura `sub_86pwavjc9oe9rqce`, `payment.status=RECEIVED`, `refunds[0].status=CANCELLED`, `refunds[0].value=49.9`. A fixture de simulação `pay_0jx1hsuu620kubkw` já tinha retornado o mesmo estado. **Ambos são cancelamentos definitivos das tentativas, não autorizações pendentes nem estornos concluídos.** Não enviar novos POSTs de estorno nesses IDs.

O painel em **Integrações > Segurança** mostra a validação de saque por webhook desabilitada; portanto não há evidência de que essa validação opcional seja a causa. Os logs de requisições exibidos não revelaram erro de estorno. A API normalmente retorna, para cada estorno, status, valor, criação e descrição, mas **não há campo de motivo de cancelamento garantido para refund**. Evitar atribuir a causa a saldo, token ou webhook sem evidência. Documentação: https://docs.asaas.com/docs/estornos e https://docs.asaas.com/reference/estornar-cobranca .

Para a última tentativa de diagnóstico sem qualquer alteração de estado, consultar ambas as cobranças de teste por `GET`:

```powershell
node .\scripts\asaas-sandbox-e2e.mjs --diagnose-refunds
```

O modo imprime apenas status, valor, data e possíveis campos técnicos, sem dados de clientes nem tokens e sem `POST` de cobrança/estorno, sem conciliar e sem alterar banco. Se o retorno não trouxer motivo, a causa depende de informações internas do Asaas/suporte. Os testes de regressão em CI já validam o tratamento de estornos cancelados, parciais e confirmados de forma simulada.
