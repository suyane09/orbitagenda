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
