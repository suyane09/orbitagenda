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
