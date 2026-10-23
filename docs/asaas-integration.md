# Integração Asaas — Orbit Agenda

## O que foi implementado

- Edge Function autenticada `asaas-subscribe`, com verificação do proprietário por membership, busca do valor do plano no banco (não aceita preço enviado pelo navegador) e criação de cliente + assinatura mensal no Asaas por Pix ou boleto.
- Cobranças criadas **somente depois de confirmação expressa** do proprietário.
- Proteção contra contratação duplicada: reserva atômica `asaas_provisioning_started_at`; uma falha inconclusiva bloqueia novas tentativas até reconciliação manual com o Asaas.
- IDs de cliente/assinatura vinculados ao estabelecimento, sem armazenar CPF/CNPJ localmente.
- Edge Function `asaas-webhook` com validação do cabeçalho `asaas-access-token`, reconsulta do pagamento via API do Asaas e persistência de eventos de forma idempotente no banco.
- Para `PAYMENT_RECEIVED` com estado `RECEIVED` verificado pelo Asaas, o registro contratual passa a `active` em transação atômica. Outros eventos permanecem disponíveis para conciliação; **não suspendem o acesso automaticamente**.
- RLS por estabelecimento nos eventos de pagamento; edição financeira e registro de pagamentos não são permitidos ao cliente.

## Estado atual de implantação

A migração SQL do Asaas e as duas Edge Functions foram publicadas no Supabase: `asaas-subscribe` exige JWT e `asaas-webhook` valida um token Asaas próprio. Elas permanecem **desativadas para cobranças enquanto os segredos Asaas não forem configurados**. A interface também está desativada por padrão para não iniciar cobrança. Após validar no Sandbox, configurar `VITE_ASAAS_BILLING_ENABLED=true` nas variáveis de ambiente da Vercel para liberar o formulário. Não habilitar essa flag antes da validação.

## Configuração obrigatória ANTES da primeira cobrança

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

- A integração não faz débito em cartão, não bloqueia acesso automaticamente por inadimplência e não desfaz status `active` no caso de estorno; os últimos casos precisam de regras comerciais e conciliação.
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
