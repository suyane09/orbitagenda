# OrbitAgenda — auditoria comercial de lançamento (25/10/2026)

## Decisão
**Pré-venda/demonstração com transparência: APTO.** **Cobrança automática e lançamento completo para barbearias reais: BLOQUEADO até conclusão dos itens abaixo.**

Esta decisão é baseada em verificação direta no GitHub, no projeto Supabase **orbitbarbearia** (somente conta suzy) e no workspace Render da desenvolvedora; não implica posse de sessão administrativa real nem acesso ao computador Windows. Nenhuma compra ou cobrança foi realizada.

## Resultado dos testes nesta rodada

| Área | Verificação | Evidência / status |
|---|---|---|
| Estrutura do banco | 25 tabelas públicas, 0 sem RLS, 0 FKs inválidas | PASSOU, consulta read-only à produção em 25/10/2026 |
| Onboarding | Duas barbearias com proprietários distintos | PASSOU, transação simulada na produção, seguida de ROLLBACK |
| Segurança multiempresa | Empresa B não visualiza A, nem assinatura da A | PASSOU, mesmo teste rollback |
| Plano inicial | Nova empresa inicia `past_due`, escrita bloqueada | PASSOU, comportamento intencional e **não é uma contratação automática** |
| Superadmin | Usuário comum não altera assinatura; admin pode ativar só A | PASSOU, via autenticação simulada por SQL dentro de transação revertida |
| WhatsApp multiempresa | Proprietário não pode vincular número de outra empresa | Adicionado teste em `supabase/tests/97_commercial_release_journey.sql` (CI descartável) |
| Reserva pública | Teste transacional da barbearia piloto criou reserva no banco e executou ROLLBACK sem disparo | PASSOU em 25/10/2026, **não é teste completo HTTP/Turnstile** |
| WhatsApp local | 1 conexão, 2 confirmações com state `accepted`, 2 lembretes `queued` | PASSOU envio à API; **entrega real não confirmada por status** |
| Pagamentos | PR #17 em draft com testes e scripts Sandbox | **NÃO LIBERADO** |
| Recuperação SQL | Backup novo restaurado em 4º Postgres Docker local: 22 tabelas do backup daquele momento | PASSOU; estrutura online cresceu posteriormente para 25 tabelas |
| WhatsApp sem PC | PR #29 CI aprovado, nenhum serviço Render WhatsApp provisionado | **NÃO LIBERADO** |

Nota: os testes transacionais não deixam barbearias fictícias e **não ativam Asaas**, PIX, webhooks nem algum número de WhatsApp. Confirme que a equipe no Windows e os logs de CI mostram o mesmo resultado antes do lançamento.

## BLOQUEADORES REAIS ANTES DE COBRAR MENSALIDADE AUTOMÁTICA

### 1. Asaas — concluir homologação e ativação protegida
- Os fluxos de vencimento, bloqueio/recovery e pagamento em Sandbox foram exercitados pelo operador no Windows, porém o *estorno integral* visto foi `refunds[].status=CANCELLED`, não `DONE`. **CANCELLED não é estorno finalizado**.
- Executar teste novo com cobrança e saldo de teste válidos (não tentar devolver as mesmas duas cobranças já canceladas), verificar `PAYMENT_REFUNDED`, `refund.status=DONE`, webhook real, repetição e eventos fora de ordem, chargeback e conciliação.
- A PR #17 depende das #15/#16 e a #18 depende #17. Não mesclar nem rodar migrações dessa cadeia cegamente; o dump atual e a história de migrations precisam ser conciliados.
- O banco atual não possui a tabela de monitoramento periódico `asaas_reconciliation_runs` e o projeto não publicou a função `asaas-reconcile`. Não classificar pagamento recorrente como autónomo e reconciliado.
- **Não ativar** `ASAAS_BILLING_ENABLED`/chave produtiva até parecer conclusivo. Não devolver nem cobrar dinheiro real neste teste.

### 2. Isolamento e clientes reais
- Confirmar telas num **usuário realmente novo** e outro perfil de proprietário/staff, em dispositivos separados. SQL com JWT simulado testa lógica, não a sessão completa no navegador.
- Verificar confirmação de email, senha, convite de equipe, agenda, alterações, relatórios, serviços, recebimento, comissão e fechamento com identidades reais de teste; usar dados fictícios e consentidos.
- Confirmar no painel que proprietários comuns não veem `/plataforma` nem outra empresa.

### 3. WhatsApp sem computador
- A PR #29 é uma proposta sob `VITE_WHATSAPP_CLOUD_ENABLED=false`. Render na conta não tem PostgreSQL ou Key Value da Evolution.
- Testar pareamento por número no mesmo celular (WhatsApp Business), troca de aparelho, QR fallback, estado `connected`, opt-in, opt-out, tempo de parada e reconexão. O código curta duração é serviço da Evolution, não recurso comprovado para todas as contas.
- Criar recursos **pagos com aprovação expressa do custo**, usando private network, credenciais secretas e sessões persistentes; sem isso o PC da operadora precisa permanecer ligado e não pode ser vendido como recurso independente do computador.
- Não ativar a feature flag nem transferir números existentes antes de homologar.

### 4. Recuperação, migrações, segurança
- O backup SQL validado corresponde a uma versão de **22 tabelas**; produção agora contém **25**. Gerar nova cópia, restaurar em clone, comparar ACL/policies/funções e historial antes de outros deploys relevantes.
- Divergência já conhecida: 13 timestamps Git vs 12 remotos de migrações mais antigas. **Não** executar `db push`, `migration repair` nem `db reset` em produção para forçar correspondência.
- Binários do Storage não estão cobertos pelo restore lógico validado.
- Supabase Security Advisor: `auth_leaked_password_protection` desabilitado; a opção pode exigir plano Supabase Pro. 13 funções `SECURITY DEFINER` executáveis por autenticados exigem avaliação de autorização (algumas são RPCs intencionais). `platform_admins` e `rate_limit_buckets` sem RLS SELECT é intencional, mas verifique privilégios diretos.
- Habilitar MFA para administradora e documentar política de privacidade, retenção e atendimento aos pedidos de exclusão (LGPD).

## O que já pode ser feito comercialmente SEM alegar homologação
- Mostrar site e painel com informações fictícias, demonstrar reservas e processos.
- Receber inscrições de interessados em **piloto assistido e gratuito**, indicando que pagamentos recorrentes automáticos e WhatsApp sem computador ainda estão em homologação.
- Em eventual cobrança **manual**, exija confirmação efetiva do pagamento, termo/contrato, suporte e teste de conta real; não equipare a RPC manual de status contratual com o recebimento do dinheiro.

## Arquivos e histórico verificáveis
- Teste descartável GitHub CI: `supabase/tests/97_commercial_release_journey.sql`.
- Auditoria SQL read-only: `supabase/audits/commercial_release_readonly.sql`.
- Asaas: [PR #17](https://github.com/suyane09/orbitagenda/pull/17), [Issue #13](https://github.com/suyane09/orbitagenda/issues/13).
- Backup/migrations: [PR #18](https://github.com/suyane09/orbitagenda/pull/18), [Issue #19](https://github.com/suyane09/orbitagenda/issues/19).
- Superadmin e contas reais: [Issue #20](https://github.com/suyane09/orbitagenda/issues/20).
- WhatsApp cloud somente celular: [PR #29](https://github.com/suyane09/orbitagenda/pull/29).
- Documentação Asaas oficial: https://docs.asaas.com/docs/refunds ; status `DONE` obrigatório para confirmação de estorno.
- Documento de autenticação Supabase: https://supabase.com/docs/guides/auth/password-security .

## Critério para mudar a decisão para GO
Somente depois de: (1) E2E autenticado real duas contas com RLS, (2) Asaas Sandbox refund+reconciliação+webhooks sem ressalvas, (3) código financeiro mesclado e implantado com migrações reconciliadas, (4) mecanismo de cobrança real habilitado controladamente com chave/credenciais corretas, (5) recuperação do backup atualizado validada, (6) WhatsApp cloud real homologado **se anunciado no plano**, (7) política de suporte, segurança e LGPD publicada.

Até cumprir esses critérios, **não declarar "pronto 100%"**.
