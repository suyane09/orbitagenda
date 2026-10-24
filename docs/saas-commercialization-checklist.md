# Comercialização OrbitAgenda — situação atual (24/10/2026)

> **Referência operacional atualizada:** [GO/NO-GO para lançamento](launch-gates-2026-10-24.md). Este resumo não autoriza qualquer deploy nem ativação de cobrança.

## O que o sistema implementa

- Multiempresa e permissões por estabelecimento (RLS), painel de proprietário, funcionários e painel da plataforma.
- Cadastro de serviços, profissionais, expediente, reservas públicas e agenda interna.
- Clientes, financeiro, comissões, repasses e fechamento de caixa.
- Planos e situação contratual; assinaturas Pix/boleto **implementadas para homologação**, com criação por Edge Function autenticada, webhooks validados, conciliação e bloqueio após prazo configurado.
- Fluxo de Asaas **Sandbox** passou nos cenários de pagamento, atraso, regularização, cancelamento e no teste negativo de estorno **cancelado**. Não houve comprovação de estorno integral concluído.
- Testes automatizados e SQL isolados: 372 verificações SQL aprovadas, mais testes de código/build e navegador no GitHub Actions. A jornada integrada com barbearia usa somente fixtures descartáveis, e os dados são fictícios.

## O que NÃO foi concluído

1. **Estorno integral real do Sandbox:** duas cobranças de teste resultaram em `payment=RECEIVED` e `refund=CANCELLED`, sem motivo técnico retornado. Falta estado final `REFUNDED`/`DONE` e webhook real `PAYMENT_REFUNDED`. Não repetir os pedidos nessas cobranças.
2. **Publicação revisada:** PRs #15, #16 e #17 ainda draft; melhorias permanecem fora da branch principal/produção.
3. **Reconciliação de migrações remotas e backup restaurado:** há scripts aplicados manualmente fora da história de migrações. Nunca rodar `db push` ou `migration repair` com hipótese de equivalência.
4. **Teste real com usuários, dispositivos e webhook externo:** CI mockado não confirma os navegadores físicos nem o fluxo Asaas completo.
5. **Operação comercial/jurídica:** validar termos, política de privacidade, atendimento, contratos, emissão fiscal, limites do plano e contingência de dados. Confirmar configuração da proteção contra senhas vazadas no Auth de produção quando disponível.
6. **Ativação de credenciais de produção, agenda de reconciliação e monitoramento:** exige autorização separada e validação prévia. Não habilitar uma chave de produção só porque o build passou.

## O que já é possível vender

- Divulgação, demonstração com dados fictícios, pesquisa de mercado, proposta e lista de interessados: **GO**.
- Primeiro cliente usando dados reais ou pagando manualmente: **NO-GO até validar os portões operacionais e de privacidade**.
- Cobrança automática recorrente de clientes reais: **NO-GO enquanto homologação financeira e release de produção estiverem pendentes**.

Mais detalhes e campos de evidência: [docs/launch-gates-2026-10-24.md](launch-gates-2026-10-24.md).
