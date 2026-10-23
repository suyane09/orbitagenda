# Orbit Agenda

Sistema web de gestão para barbearias e salões: agendamento interno, página pública de reservas, clientes, serviços, profissionais, expediente, bloqueios, financeiro, fechamento de caixa e comissões com repasses registrados.

## Recursos

- **Agenda:** agendamento com horário, profissional, serviço, status e prevenção de conflitos no PostgreSQL.
- **Reserva pública:** catálogo e escolha de horários; proteção contra abuso com Cloudflare Turnstile e rate limiting na Edge Function.
- **Financeiro:** receitas, despesas, estornos, pagamentos parciais, valores a receber e fechamento do dia.
- **Comissões:** regra por profissional, captura ao concluir atendimento, cálculo sobre valores efetivamente recebidos e histórico de repasses. **Registrar repasse não transfere dinheiro nem lança despesa automaticamente.**
- **Relatórios:** faturamento por recebimentos, saldo financeiro, serviços concluídos, ticket médio e rankings por profissional e por serviço, com filtros de período.\n- **Asaas (homologação):** backend para criação autorizada de assinaturas Pix/boleto e webhooks idempotentes; depende de configurar credenciais e implantar as Edge Functions. UI de contratação desativada por padrão (`VITE_ASAAS_BILLING_ENABLED`). Consulte `docs/asaas-integration.md`.\n- **Planos e contratos:** central administrativa para cadastrar preços e atribuir situação contratual e página do proprietário para consultar a assinatura. Esta primeira versão **não cobra, não suspende o serviço automaticamente e não integra gateway de pagamento**.\n- **Configurações do estabelecimento:** edição dos dados da empresa e compartilhamento do link público de agendamento, exclusiva para proprietário.\n- **Equipe e acessos:** proprietário gera convites seguros por link válido por 7 dias para e-mails confirmados, controla acesso ativo/inativo e consulta histórico de convites. O link deve ser enviado pelo proprietário: o sistema ainda não dispara e-mails automaticamente.\n- **Multiempresa:** vínculos e permissões por estabelecimento, protegidos por políticas RLS no Supabase.
- **Painel da plataforma:** listagem de estabelecimentos para administradores.

## Tecnologias

React, TypeScript, Vite, Tailwind CSS, Supabase (PostgreSQL, Auth, RLS, Edge Functions), Vercel.

## Desenvolvimento

Configure as variáveis públicas descritas em `.env.example`; nunca coloque chaves secretas `service_role` no frontend.

```bash
npm ci
npm run dev
npm test
npm run build
```

A suíte SQL usa um banco PostgreSQL **descartável**, criado pelo script `supabase/tests/run.sh`, e não deve apontar para produção.

## Cuidados de produção

- O banco de produção já recebeu migrações aplicadas manualmente no SQL Editor; algumas versões antigas ainda não constam no histórico da CLI.
- **Não executar `supabase db push`** antes de concluir a reconciliação documentada em `docs/migration-reconciliation.md`.
- Comissões concluídas antes da implantação da etapa 2C não são geradas retroativamente.
- Revisar os alertas do Security Advisor e habilitar proteção contra senhas vazadas na configuração de Auth, quando disponível.
- Validar alterações via testes e GitHub Actions antes de atualizar a branch principal.

## Publicação

O projeto utiliza `vercel.json` para servir as rotas da aplicação React. O banco, a autenticação e as Edge Functions ficam no Supabase. Mudanças no repositório **não aplicam** novas migrações automaticamente.
