# Asaas Sandbox — solicitação de diagnóstico de estornos CANCELLED

**Uso:** texto pronto para abrir uma solicitação no suporte do Asaas Sandbox, sem compartilhar chaves de API, dados pessoais ou arquivos do banco. É uma investigação do provedor, não uma instrução para repetir operações financeiras.

**Assunto:** Dois estornos Sandbox cancelados sem motivo na API — como homologar refund concluído?

Olá, equipe Asaas.

Estamos homologando no ambiente **Sandbox** a integração de assinaturas recorrentes do sistema OrbitAgenda. Em **24/10/2026**, tivemos dois estornos de R$ 49,90 que terminaram no status `CANCELLED`, sem mensagem ou razão técnica retornada pelos endpoints de consulta:

1. **Estorno solicitado pela API:** cobrança `pay_41pnfrerqc0b4qv5`, assinatura `sub_86pwavjc9oe9rqce`. Data de criação do estorno retornada: `2026-10-24 15:31:53`. Resultado atual: `payment.status=RECEIVED`; um item de `refunds` com `status=CANCELLED`, `value=49.90`.
2. **Simulação pela ação do painel Sandbox:** cobrança `pay_0jx1hsuu620kubkw`, assinatura `sub_tetr2mo4f95c0x7y`. Data de criação do estorno retornada: `2026-10-24 16:28:32`. Resultado atual: `payment.status=RECEIVED`; um item de `refunds` com `status=CANCELLED`, `value=49.90`.

A consulta `GET` retornou os valores e os estados, **sem qualquer campo indicando o motivo do cancelamento**. Na tela **Integrações → Segurança**, a validação de saque via Webhook estava desabilitada. Não reenviamos os pedidos de estorno.

Podem, por gentileza, nos informar:

1. Qual foi o motivo de `CANCELLED` em cada cobrança de teste? Existe algum evento, log ou configuração do Sandbox que indique a causa?
2. Qual é o procedimento recomendado para validar um **estorno integral concluído**, de modo que `refund.status=DONE`, `payment.status=REFUNDED` e o evento `PAYMENT_REFUNDED` sejam observados no Sandbox, sem repetir operações em cobranças já canceladas?
3. Há alguma restrição específica de estorno de cobrança Pix **simulada como recebida** pelas ações do Sandbox que explique esse comportamento?

Precisamos dessa homologação para liberar o fluxo financeiro real apenas depois de comprovar a integração. Obrigada.

---

**Registro interno:** não disponibilizar API key, token de webhook, secrets Supabase, CPF/CNPJ, e-mail dos clientes ou dump de dados. Não criar/reenviar estorno nestas cobranças. Dependência externa aberta; o restante dos testes automatizados passou.
