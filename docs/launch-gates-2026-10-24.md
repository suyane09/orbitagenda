# Lançamento comercial OrbitAgenda — portões GO/NO-GO

Revisado em 24/10/2026. **Documentação de homologação, não autorização para publicar.**
A branch de trabalho atual é `fix/asaas-reconciliation-overdue-order-20261024`, dependente das PRs draft #15, #16 e #17. Nenhuma dessas mudanças vai automaticamente ao Vercel/Supabase de produção.

## O que foi testado com segurança

- Vitest, build e smoke Chromium no GitHub Actions. A verificação antiga cobria majoritariamente login/cadastro; foi ampliada para reserva pública simulada (catálogo → serviço → profissional → horário → formulário; sem realizar agendamento real).
- PostgreSQL 17 isolado e descartável: **372 asserções SQL aprovadas, 0 falhas** após incluir `supabase/tests/65_pilot_journey.sql`. O novo cenário faz o ciclo de uma barbearia, com duas empresas para isolamento RLS, agenda, conflito, conclusão, receita, comissão, caixa fechado e reabertura.
- Asaas **Sandbox** + banco local: atraso e regularização, cancelamento respeitando período pago, estorno `CANCELLED` tratado como **não devolvido**. Tentativas em `pay_41pnfrerqc0b4qv5` e `pay_0jx1hsuu620kubkw` retornaram `CANCELLED` e `RECEIVED`. **Estorno total `DONE` e entrega de `PAYMENT_REFUNDED` real continuam não comprovados.**
- A API do catálogo público agora devolve o fuso IANA do estabelecimento, e a validação rejeita dias impossíveis.

Essas evidências **não** equivalem a um teste com contas reais em dispositivos reais, nem a um restore do backup de produção, nem a autorização de cobrança real.

## GO 1 — Divulgação e demonstrações

**Pode começar agora:** apresentar protótipo com dados fictícios, captar interessados, negociar preço/limites e cadastrar lista de espera. Não informar que o débito recorrente real ou o estorno integral já estão homologados. Não cadastrar dados de clientes sem base legal/aviso e ambiente preparado.

## NO-GO 2 — Primeira barbearia operando com dados reais

Antes de liberar operação real, obter confirmação/evidência de TODOS os itens:

- [ ] **Migrações:** comparar manualmente a estrutura do Supabase remoto com cada SQL local que foi executado no SQL Editor. O histórico remoto contém divergências, inclusive etapa 2B/2C de comissões. NÃO executar `supabase db push` nem `migration repair` sem equivalência exata e backup recuperável; ver `docs/migration-reconciliation.md`.
- [ ] **Backup restaurado:** testar a restauração de schema+dados em **instância isolada** equivalente ao Supabase, sem reutilizar a produção e sem enviar dados reais a GitHub Actions. Registrar data, versão, sucesso de integridade e forma de descarte seguro. O simples fato de ter `roles.sql`, `schema.sql` e `data.sql` não é prova de restauração.
- [ ] **Autenticação e permissões:** configurar proteção contra senhas comprometidas no Supabase Auth, revisar advisors, ativar MFA de contas administrativas quando aplicável, conferir RLS e usuários com papéis `owner`, `staff` e admin em navegador real.
- [ ] **Proteção de reserva pública:** Turnstile site key no frontend e secret + allowed hostnames no backend, limites operantes, domínio autorizado, teste de reserva real de ida e volta, conflito e cancelamento.
- [ ] **Operação com conta piloto:** proprietário cadastra empresa, serviço, profissional, expediente e cliente; terceiro faz reserva pública; equipe recebe e conclui; proprietário confere receita/comissão e caixa; testar em Android/iPhone e desktop, em fuso do estabelecimento e conta de segunda empresa. Assinalar nomes dos testadores e data.
- [ ] **LGPD e comunicação:** identificar controlador/operador, contato de privacidade e suporte, finalidade/retenção, consentimento ou base adequada, aviso acessível ao cliente, termos comerciais e política de privacidade revisados por responsável. Não criar dados ou promessas legais fictícias.
- [ ] **Operação e suporte:** canal de atendimento definido, procedimento de incidente, alertas, recuperação de backup, treinamento curto, política de exportação e encerramento contratual. Conferir nota fiscal e formalização com profissional contábil.
- [ ] **Publicação:** revisar diff/PRs na ordem correta, aplicar migrações após homologação, configurar variáveis do ambiente, testar aplicação implantada e rollback. Exige autorização separada. Não assumir que CI da branch altera produção.

Pagamento manual durante piloto pode ser negociado, **mas só depois** de os portões de segurança/dados/operacional acima estarem comprovados. O cliente deve entender claramente o que será entregue e como será cobrado.

## NO-GO 3 — Assinatura recorrente automática em produção

Além de TODOS os itens de NO-GO 2:

- [ ] Obter explicação do Asaas para estornos `CANCELLED`, homologar **novo caso controlado e autorizado** de estorno integral em Sandbox com `payment.status=REFUNDED`, devolução `DONE`, `PAYMENT_REFUNDED` e bloqueio/reativação esperados. Nunca repetir os POSTs de estorno nas duas cobranças antigas.
- [ ] Validar integração completa Asaas **Sandbox** com assinatura iniciada pelo proprietário, assinatura `sub_*` persistida, eventos autenticados reais recebidos, webhook duplicado/fora de ordem, indisponibilidade e conciliador diário autenticado. Simulações de regra em testes SQL não substituem o webhook externo.
- [ ] Configurar Asaas produção com chave e token separados, revisão de plano, vencimento, carência (5 dias), reativação, cancelamento e política de reembolso. Confirmar que não há assinaturas Sandbox vinculadas a empresas reais.
- [ ] Revisar agendamento diário de `asaas-reconcile`, monitoramento de divergências, autenticação dos endpoints, cabeçalhos de segredo, rotação de credenciais e fail-closed.
- [ ] Exigir confirmação humana explícita antes de qualquer troca para `ASAAS_ENVIRONMENT=production`, `ASAAS_PRODUCTION_CONFIRMED=true`, `ASAAS_BILLING_ENABLED=true` e `VITE_ASAAS_BILLING_ENABLED=true`. Separar deploy de aprovação de migrações.

## Critério formal de encerramento

A pessoa responsável registra em revisão de PR as evidências de cada checkbox, o aceite comercial, o plano de suporte/rollback e a autorização de publicação. **Até lá: GO apenas para divulgação/demonstração com dados fictícios; NO-GO para operação real não validada e cobrança automática.**
