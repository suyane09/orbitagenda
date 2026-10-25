# Recuperação pontual de pagamento Asaas Sandbox

Esta função **não cria cobrança nem altera o estado sem consultar a API do Asaas**. A chave continua no segredo `ASAAS_API_KEY` do Supabase e nunca chega ao navegador.

## Segurança

- POST autenticado com JWT de usuário real. O backend valida a sessão com Supabase Auth e verifica vínculo `memberships.role=owner` / `is_active=true` para o estabelecimento solicitado.
- Recusa qualquer ambiente diferente de `ASAAS_ENVIRONMENT=sandbox`; nunca consulta Asaas produção.
- Confere ID da assinatura e ID do cliente no provedor; quando presente, confere também externalReference = establishment_id.
- Lista cobranças **existentes** da assinatura pelo endpoint GET e verifica cada pagamento diretamente em GET /payments/{id}; rejeita cobrança de outra assinatura/cliente, valores diferentes, estorno, cancelamento, atraso ou data inválida.
- Reutiliza RPC de banco `record_asaas_billing_event`, com ID determinístico de conciliação para garantir idempotência.
- Não altera flags de cobrança, não cria clientes, assinaturas ou pagamentos; chamadas ao Asaas são exclusivamente GET. Sem tabela nova ou migração.
- Se a lista estiver truncada, se houver falha de API ou se os dados do pagamento divergem, falha de forma segura em vez de ativar a empresa.
- Sandbox **não comprova dinheiro real**; a feature não cobre produção.
- Exige click explícito em `/app/assinatura` > **Conferir pagamento no Asaas Sandbox** para uma assinatura `past_due` já vinculada. O `Atualizar dados` anterior não consulta o Asaas.

## Implantação / testes

- Arquivos: `supabase/functions/asaas-sandbox-sync/index.ts` e `verify.ts`. Instalar Edge Function com `verify_jwt=true`.
- No frontend: `src/features/subscriptions/SubscriptionPage.tsx`, novo botão só para pagamento sandbox pendente e já vinculado.
- Cobertura: `verify.test.ts`, CI Vite e PostgreSQL da branch.
- Verificar depois de clicar que assinatura virou `active`, evento foi registrado exatamente uma vez e **nenhuma nova cobrança** foi criada no Asaas.

## Causa do incidente de 25/10/2026

Webhook orbitagenda estava desativado; sandbox mostrou pagamento R$ 49,90 RECEIVED mas não houve registro da nova assinatura em `public.asaas_payment_events`. Ativar webhook prepara eventos futuros, mas não reconstitui automaticamente eventos antigos. Esta recuperação pontual permite buscar o pagamento diretamente no provedor.

## Limitações remanescentes

Conciliação recorrente de todas as assinaturas, webhooks de estorno/chargeback e teste de refund DONE continuam pendentes na PR #17 e issue #13. Não declarar Asaas pronto para cobrança real com base neste reparo.
