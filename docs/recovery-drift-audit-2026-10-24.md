# OrbitAgenda — auditoria de migrações e recuperação (24/10/2026)

**Escopo:** leitura de metadados do projeto Supabase online `peajkbjwusivdrqjoqtl`, restauração anterior realizada pelo operador em Docker **isolado**, e comparação com o commit `f621bc39fd70eb88e5a1a394e75789195faf49f8`. Este documento **não autoriza deploy, reparo de histórico ou faturamento real**.

## Evidência de recuperação LOCAL

O operador apresentou a saída de `finalizar_isolado_22.ps1` com:

- destino `supabase_db_orbitagenda-restore-isolado`, porta `54522`, PostgreSQL 17.11;
- migração 2C com teste transacional de conclusão e snapshot, parcial/integral/estorno, seguida de `ROLLBACK`;
- dump local anterior às migrações verificado pelo script;
- seis tabelas adicionais instaladas exclusivamente no clone;
- resultado `ESTRUTURA_22_VALIDADA`: **22 tabelas**, políticas RLS e guarda de cobrança nos testes estruturais.

**Limitação crucial:** a origem era um dump anterior da produção. Isso verifica a *capacidade de recuperação do esquema e dos dados naquele ponto*, não um backup atualizado da produção atual. Dump não inclui binários do Storage nem configuração/secrets de funções.

## Consulta independente REMOTA — apenas SELECT

Projeto Supabase online com **22 tabelas `public`**, todas com `relrowsecurity=true`. Uma view `appointment_commission_balances` e o trigger 2C habilitado.

Um resumo das definições SQL reais no instante da consulta, sem dados de clientes:

| Categoria | Objetos | MD5 do inventário canônico |
|---|---:|---|
| colunas | 178 | `4efb9cefedce911923052a15ac2ec1e9` |
| constraints | 138 | `522697bbd7fd509711b15d1c46e0d85f` |
| funções public/private | 41 | `2abd0231a1730883c6456352c4e61688` |
| índices | 63 | `a7864b346fe4bf1502318cf596c4c947` |
| políticas RLS | 94 | `c780e6961f93d8bb6447c4df9519e6ee` |
| triggers não internos | 23 | `bfa683db9a6d8bbfe8574deaa7299e34` |
| views | 1 | `a4caa190c292956c0b4cd7a4fd2fda36` |

Os MD5 acima são **marcadores de comparação técnica, não hashes criptográficos de autenticação**. Ausência de diferença não comprova equivalência de dados, grants de roles, Storage e infraestrutura; diferenças são esperadas quando a produção recebeu mudanças depois do clone.

## Histórico de migrações

- **31** scripts SQL `supabase/migrations` na branch de homologação.
- **30** versões em `supabase_migrations.schema_migrations` no banco remoto.
- **13** versões de arquivos locais não coincidem exatamente com versões remotas.
- **12** versões remotas não possuem arquivos locais com *o mesmo timestamp*.

Arquivos locais sem versão remota idêntica:

```text
20261023150000_finance_v1.sql
20261023170000_cash_closings.sql
20261023180000_commission_rules_stage1.sql
20261023200000_commission_accrual_review.sql
20261024020000_billing_grace_and_event_order.sql
20261024045200_billing_cancelled_and_missing_due_date_guard.sql
20261024055000_billing_fail_closed_missing_subscription.sql
20261024055800_billing_unbounded_trial_and_manual_overdue.sql
20261024065000_billing_security_definer_guards.sql
20261024070100_self_service_pending_subscription.sql
20261024110500_revoke_anon_billing_helper.sql
20261024120000_asaas_reversals_cancellations.sql
20261024130000_asaas_reconciliation.sql
```

Versões remotas sem arquivo de mesmo timestamp:

```text
20261024004416 asaas_billing_five_day_grace_and_write_guard
20261024004422 billing_guard_preserve_read_access
20261024012549 protect_public_booking_from_unpaid_subscription
20261024014804 billing_calendar_grace_and_out_of_order_events
20261024014921 member_safe_billing_block_status_rpc
20261024015310 billing_status_rpc_security_invoker
20261024015356 preserve_manual_suspension_during_asaas_webhooks
20261024045122 billing_block_canceled_and_missing_due_date
20261024055209 billing_fail_closed_without_subscription_and_expired_trial
20261024055327 billing_fail_closed_for_unbounded_trial_and_manual_overdue
20261024064705 billing_guard_security_definer_tenant_mutations
20261024100417 self_service_pending_subscription_20261024
```

**NÃO** executar `supabase db push`, `db reset --linked`, `migration repair` ou sobrescrever arquivos SQL na produção com base em versões/nome semelhantes. A 2C foi aplicada manualmente e diverge da antiga 2B em histórico/restrições. É necessário comparar **cada definição de função, constraint, policy, trigger, default e GRANT** da versão efetivamente aplicada, de preferência em novo clone com backup recente, e revisar manualmente a reconciliação. Um script composto equivale a várias migrations remotas; reparo só de timestamp não garante equivalência.

## Segurança e prontidão

Supabase Security Advisor (somente leitura): 10 funções `SECURITY DEFINER` executáveis por `authenticated`; conferir as autorizações internas antes de alterar privilégios. Aviso de RLS sem policy em `platform_admins` e `rate_limit_buckets` pode representar negação intencional. **Proteção contra senhas vazadas permanece desativada**; requer configuração no painel Auth quando disponível.

Asaas Sandbox ainda depende de devolução realmente concluída `DONE` / `REFUNDED` e webhook validado; dois estornos anteriores ficaram `CANCELLED`. Não criar novos POSTs de estorno nas cobranças antigas. Necessária homologação completa de Turnstile, contas reais de teste e dispositivos antes de processar dados reais ou cobrar assinaturas.

## Próxima ação segura — backup novo

`scripts/backup-producao-readonly.ps1` faz **somente** três `supabase db dump --linked` depois de verificar o `supabase/.temp/project-ref`. Armazena localmente `roles.sql`, `schema.sql`, `data.sql` e manifesto SHA-256, sem publicá-los.

Requisitos: Windows, npx, Docker Desktop, Supabase CLI autenticada, *pasta do projeto vinculada ao projeto correto*. O script aborta se o projeto não estiver vinculado ou ID não corresponder. Os dumps são confidenciais (dados Auth e pessoais) e devem ficar **criptografados fora do repositório**. Sua execução não é prova de restauração: testar em uma instância **nova** e isolada, pois importar novamente no clone de 22 tabelas sobrescreveria/colidiria com os dados.

Nenhuma consulta de metadados, inventário ou comentário de GitHub deste documento modificou a produção.
