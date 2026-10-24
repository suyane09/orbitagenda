# Auditoria de backup e estrutura — 24/10/2026 (somente leitura)

**Objetivo:** registrar a compatibilidade do backup entregue pelo operador com o projeto Supabase `orbitbarbearia` (conta conectada `suzy`) e com a branch de homologação, **sem copiar SQLs ou dados pessoais ao GitHub**.

## Evidência estática dos arquivos locais

- Foram recebidos `roles.sql` (370 bytes), `schema.sql` (105.738 bytes) e `data.sql` (33.693 bytes).
- A estrutura possui **16 tabelas public** e 30 funções; os dados incluem **49 blocos COPY** (Auth/Public/Storage), todos com terminadores e número de colunas coerentes na inspeção de texto.
- Os 16 blocos COPY `public` têm correspondência com as tabelas de `schema.sql`.
- Origem registrada no dump: PostgreSQL 17.11.
- `data.sql` contém **dados de autenticação, incluindo sessões/refresh tokens**: deve permanecer sob guarda privada e criptografada. Não compartilhar com GitHub, logs, suporte nem publicar como artefato de CI.
- Uma inspeção de texto **não comprova** restauração íntegra. **Restore real NÃO executado**; seria necessário destino Supabase compatível isolado, com serviços Auth/Storage e extensões.

## Divergência de esquema — metadados do Supabase remoto

Consulta read-only ao Supabase: 22 tabelas `public`, todas com RLS habilitado. Seis tabelas **não existem nesse backup anterior**:

- `appointment_commission_snapshots`
- `asaas_payment_events`
- `commission_payouts`
- `establishment_subscriptions`
- `subscription_plans`
- `team_invitations`

Exemplos de contagem anterior→atual (podem variar): `appointments` 6→8, `financial_entries` 8→9, `rate_limit_buckets` 22→31. Portanto o backup está **desatualizado para a produção atual**, não deve ser a única via de recuperação e deve ser refeito antes de qualquer release.

## Divergência de migrações

- Branch `fix/asaas-reconciliation-overdue-order-20261024`: **31 arquivos SQL** em `supabase/migrations`.
- História remota: **30 entradas**.
- Comparação exata versão+nome: **13 arquivos locais sem correspondência no histórico remoto**, e **12 versões remotas sem arquivo correspondente local**.
- Parte das mudanças pode ter sido aplicada manualmente por SQL Editor ou com versões de migração distintas. Não presumir que o código não exista; exige **comparar definição de funções/policies, tabelas e triggers** antes de reconciliar.
- **NÃO** usar `db push`, `migration repair`, `DROP`, ou aplicar migrações da branch na produção até ter restore bem-sucedido em clone isolado e revisão do plano/rollback.

## Segurança — apenas observações de advisor

- Proteção contra senhas comprometidas no Supabase Auth está desativada.
- Advisor apontou 10 funções `SECURITY DEFINER` acessíveis por `authenticated`; cada uma requer revisão do controle interno de autorização. Um aviso não prova vulnerabilidade, pois permissões e verificações podem ser intencionais.
- `platform_admins` e `rate_limit_buckets` têm RLS sem policy para cliente, possivelmente intencional por negarem acesso direto. Verificar antes de alterar.

## Encaminhamento obrigatório

1. Obter **novos três dumps** do ambiente atual, guardá-los em local privado protegido.
2. Fazer teste de **restauração transacional em Supabase/Postgres 17 isolado**, com Auth/Storage compatível; verificar contagens, relações, roles, funções e RLS sem expor dados.
3. Conciliar histórico de migrações com estrutura efetiva e preparar alterações reversíveis.
4. Cumprir [portões de lançamento](launch-gates-2026-10-24.md) antes de operar com clientes ou ativar cobrança real.

**Status:** inspeção estática ✅; consulta de metadados de produção read-only ✅; restauração verificável ❌; migrações reconciliadas ❌. Nenhuma alteração realizada no Supabase remoto ou em pagamentos.

Documentação do Supabase sobre restore de plataforma: https://supabase.com/docs/guides/self-hosting/restore-from-platform
