# Orbit Agenda — Etapa 1 (fundação) + Etapa 2 (Serviços, Profissionais, Horários e Clientes)

SaaS multiempresa para barbearias e salões. React + Vite + TypeScript + Tailwind v4 + Supabase.

## Rodar localmente
```bash
npm install
cp .env.example .env        # preencha URL e anon/publishable key (NUNCA a service_role)
npm run dev
```

## Banco (Supabase)
```bash
npm i -g supabase
supabase init               # não sobrescreve supabase/migrations
supabase link --project-ref SEU_REF
supabase db push            # aplica as 9 migrações em ordem (revise a 0007, 0008 e 0009 antes)
```
No painel do Supabase → Authentication → URL Configuration, inclua em *Redirect URLs*:
`http://localhost:5173/entrar` e `http://localhost:5173/redefinir-senha` (e os equivalentes de produção).

### Criar o primeiro superadmin (somente via SQL Editor)
Não existe caminho pela API/frontend para isso, de propósito:
```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'voce@empresa.com';
```

## Modelo de segurança (resumo)
- Papéis: `superadmin` (tabela `platform_admins`, sem grants para a API), `owner` e `staff` (`memberships.role`).
- Estabelecimento só nasce via RPC `create_establishment`: o dono é sempre `auth.uid()`.
- `INSERT` direto em `establishments` e `memberships` é negado; colunas sensíveis (`role`, `user_id`, `slug`, `created_by`) não são atualizáveis pelo cliente.
- FKs compostas `(id, establishment_id)` impedem referência entre empresas mesmo com bug de aplicação.
- Helpers de RLS em `private.*` (SECURITY DEFINER, `search_path = ''`, `EXECUTE` só para `authenticated`) evitam recursão.
- O frontend usa só a anon key; `getEnvError()` bloqueia a app se detectar uma chave `service_role`.

## Testes
```bash
npm run typecheck
npm test                    # unitários (Vitest)
npm run test:db             # RLS/isolamento em PostgreSQL real (precisa de psql e um Postgres)
```
`test:db` usa `ADMIN_URL` (padrão `postgresql://postgres:postgres@localhost:5432/postgres`), cria um banco descartável por arquivo `NN_*.sql`, aplica um *shim* mínimo do Supabase (`auth.uid()`, roles `anon`/`authenticated`) + as migrações e roda `10_tenant_isolation.sql`, `20_catalog.sql`, `30_schedule.sql` e `40_customers.sql`.

## Limitações conhecidas da Etapa 1
- Convite de funcionários e tela de agenda ainda não existem (etapas seguintes); vínculos `staff` são criados por SQL privilegiado.
- Os testes de banco rodam em Postgres puro com shim; ainda não foram executados contra um projeto Supabase real.
- Tipos do banco escritos à mão no frontend; gere com `supabase gen types typescript` quando linkar o projeto.
"# orbitagenda" 
