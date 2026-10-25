# OrbitAgenda — entrega de engenharia e plano de ativação segura (25/10/2026)

**Estado:** protótipo/demonstração habilitado; **NÃO APROVADO** para operação real com clientes pagantes, nem para débito automático Asaas. Esta nota não aprova deploy.

## Já realizado à distância

- GitHub PR #17: branch financeira com testes anteriores aprovados; permanece **draft** e **não foi mesclada**.
- GitHub PR #18: documentação de reconciliação das migrações e scripts de backup, restauração e auditoria; permanece **draft**, sem SQL de escrita em produção.
- Supabase remoto (`peajkbjwusivdrqjoqtl`) checado somente por SQL SELECT: **22 tabelas em public**, nenhuma com RLS desligada, **0 superadministradores**, uma assinatura e um estabelecimento, estruturas de conciliação e de estorno **ausentes**.
- Edge Functions remotas ativas: `public-booking`, `asaas-subscribe`, `asaas-webhook`. A função `asaas-reconcile` ainda não está implantada.
- Security Advisor: proteção contra senhas vazadas desativada; dez funções `SECURITY DEFINER` com EXECUTE para autenticados (revisar autorização interna); duas tabelas com RLS sem políticas (pode ser deny-by-default).
- Quarto banco local **criado pelo operador** e confirmado saudável: `supabase_db_orbitagenda-recuperacao-atual-20261024` em `localhost:54622`. **Não acessível pelos conectores da nuvem.**
- Backup atual criado no Windows: `$HOME\orbitagenda-backups-producao\20261024-214956`, contendo `roles.sql`, `schema.sql`, `data.sql` e `manifesto.json` com hash SHA-256. Não compartilhe esses arquivos.
- Novo script `scripts/restore-backup-isolated-windows.ps1` no GitHub: confere IDs, contêiner, porta, hash, blocos COPY, banco vazio e PG 17. Importa no quarto banco com transação única e audita tabelas/RLS, FKs e os dados essenciais. **Ainda não executado no Windows do usuário.** Sintaxe PowerShell testada no CI, mas não prova execução real.

## O que fazer no Windows quando estiver disponível

1. Abra Docker Desktop e confirme que o **quarto** Postgres está ativo (container exato acima). **Não rode** `supabase db reset`, `supabase db push`, `docker system prune`, `docker rm` ou `supabase stop --all`.
2. Baixe o arquivo **`scripts/restore-backup-isolated-windows.ps1` da branch PR #18** e salve em Downloads.
3. Execute no PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\Downloads\restore-backup-isolated-windows.ps1"
```

4. Anote **somente** indicadores de status que não exponham dados pessoais:
   - `BACKUP_CHECKSUMS_OK`
   - `ISOLATED_DESTINATION_OK`
   - `SQL_RESTORE_COMMITTED`
   - `RESTORE_STRUCTURALLY_VALIDATED`
5. Se surgir `VERIFICACAO_PENDENTE`, **não tente de novo no mesmo banco** sem verificar o que já foi importado. Os logs detalhados ficam no seu PC e **não devem ser compartilhados publicamente**.

**Nota:** o script limita as escritas ao banco descartável quarto, mas `SQL_RESTORE_COMMITTED` significa que a importação já foi efetivada nesse clone; falha nas verificações posteriores não reverte o commit. Não foi testada a restauração dos arquivos binários Supabase Storage.

## Critérios de liberação de primeiro cliente real

- [ ] Restore dos **dados atuais** concluído no quarto Postgres, com validação de Auth, tabelas, RLS, constraints e FKs.
- [ ] Migrações 13 locais / 12 remotas divergentes conciliadas por DDL real, sem `db push` cego, e backup com plano de reversão.
- [ ] Superadministrador provisionado **somente com UID confirmado e autorizado**; login e isolamento de funções de administração testados. Issue #20.
- [ ] Validação dos fluxos: cadastro, acesso de proprietário/equipe, segunda empresa, agenda, reserva pública/Turnstile, financeiro, comissões, cancelamento, relatório e restauração em aparelhos reais.
- [ ] Proteção contra senhas vazadas, MFA de administradores e avaliação das permissões/RLS.
- [ ] Política de privacidade, contratos, atendimento ao suporte e plano de incidentes/backup.
- [ ] Aprovação de release, publicação com monitoramento e plano de rollback.

## Critérios adicionais para Asaas automático

- [ ] Instalar migrações revisadas de estorno/reconciliação, deploy da função `asaas-reconcile` e atualização controlada do webhook.
- [ ] Homologar estorno **concluído** no Asaas Sandbox; anteriormente 2 tentativas foram `CANCELLED`, não `DONE`. Não repetir estorno nos pagamentos antigos.
- [ ] Homologar webhook verdadeiro com tokens em sandbox, eventos duplicados/fora de ordem, assinatura/atraso/reativação e cancelamento.
- [ ] Configurar job de conciliação, alertas e acesso mínimo.
- [ ] **Só então** revisar ambiente production, chaves e webhooks, com autorização explícita. Não ligar flags `ASAAS_PRODUCTION_CONFIRMED`, `ASAAS_BILLING_ENABLED` e `VITE_ASAAS_BILLING_ENABLED` antecipadamente.

## Referências permanentes

- PR #17 — https://github.com/suyane09/orbitagenda/pull/17
- PR #18 — https://github.com/suyane09/orbitagenda/pull/18
- Issue #19 — https://github.com/suyane09/orbitagenda/issues/19
- Issue #20 — https://github.com/suyane09/orbitagenda/issues/20
- Issue #13 — https://github.com/suyane09/orbitagenda/issues/13

**Limite de acesso:** sem controle do PowerShell / Docker local, da conta Asaas Sandbox/Produção e do provedor Auth, não é possível concluir essas dependências apenas pelos conectores GitHub/Supabase. Testes CI e SQL estáticos não substituem E2E real nem liberação operacional.
