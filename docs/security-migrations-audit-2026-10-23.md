# Auditoria de segurança e migrações — 23/10/2026

## Resultado da leitura da produção

- Comissões e repasses ativos; snapshots criados em atendimentos concluídos após 2C.
- `public.platform_admins` e `public.rate_limit_buckets`: RLS ligada, acesso SQL concedido apenas a `postgres` / `service_role`. O aviso "RLS sem política" é esperado **se** essas tabelas permanecerem exclusivamente internas; não adicionar política pública para silenciar o aviso.
- 5 funções `SECURITY DEFINER` executáveis por `authenticated` aparecem no linter: `create_establishment`, `is_platform_admin`, `close_cash_day`, `reopen_cash_day`, `record_commission_payout`. Todas são utilizadas pela aplicação e contêm validações de identidade/papel. O linter sinaliza superfície privilegiada, não confirma exploração. Não revogar execução nem converter para `SECURITY INVOKER` sem redesenhar permissões e reexecutar os testes de integração.
- `public.memberships` possui dois pares de políticas `PERMISSIVE` para UPDATE/DELETE, combinados por OR. A migração `20261023235000_memberships_rls_consolidation.sql` preserva as regras existentes como uma política por operação; a suíte de banco deve ser executada antes de publicar.
- "Leaked Password Protection" está desabilitado: configurar no painel Supabase Auth/Passwords, considerando disponibilidade do plano. Não pode ser corrigido por RLS.
- Avisos de índice sem uso devem ser monitorados com tráfego real; não remover índices com base em estatísticas de uma base pequena.
- Avisos de chaves estrangeiras sem índice precisam de análise da ordem das colunas em índices já existentes e planos de execução.

## Histórico de migrações: **não usar supabase db push ainda**

A consulta a `supabase_migrations.schema_migrations` retornou somente:
- `20261023120000_public_booking_rate_limit`
- `20261023213057_commission_payouts_stage3`

Entretanto a base possui também estruturas executadas via SQL Editor:
- `financial_entries`, `cash_closures` e eventos;
- `professional_commission_rules`;
- `appointment_commission_snapshots` e VIEW `appointment_commission_balances` (etapa **2C**, não 2B).

O GitHub conserva migrações locais `20261023150000`, `170000`, `180000`, `200000` (esta última é o roteiro antigo **2B**), e `230000` (repasses etapa 3), que não correspondem diretamente aos registros remotos. **Uma execução de `db push` sobre o projeto de produção poderá tentar executar scripts sobre objetos existentes.**

### Plano seguro de reconciliação

1. Gerar e manter um backup recente verificável (esquema e dados) antes de qualquer reparo de histórico.
2. Conferir diferenças entre o conteúdo EXATO dos scripts e as definições em produção (colunas, índices, grants, constraints, triggers, funções, RLS). Não assumir equivalência apenas porque as tabelas existem.
3. Substituir o roteiro 2B local pelo script efetivamente aprovado 2C em uma revisão separada (com hash/integração de testes); não inventar a partir do banco sem revisão.
4. Em um clone isolado, simular o plano da CLI; se necessário, reparar as versões específicas do histórico apenas após equivalência comprovada.
5. Só então promover novas migrations da branch.

**Esta branch não executa reparos automáticos de histórico nem altera os dados dos clientes.**

Referências:
- https://supabase.com/docs/guides/database/database-linter
- https://supabase.com/docs/guides/cli/managing-environments
