# OrbitAgenda — inventário de estrutura remota sem dados de clientes (25/10/2026)

Executado por consulta SQL de **somente leitura** no Supabase `peajkbjwusivdrqjoqtl`. Consulta reutilizável: `supabase/audits/schema_fingerprints_readonly.sql`. Resultados representam o banco remoto no momento da consulta, **não** a restauração do dump do dia 24/10.

| Categoria | Objetos | MD5 |
|---|---:|---|
| acl | 23 | `0b12eb259533d76863151e5c6f51ead1` |
| column | 178 | `4efb9cefedce911923052a15ac2ec1e9` |
| constraint | 138 | `592556d6d7fc207ba634bab704c8fd39` |
| function (public/private) | 41 | `2abd0231a1730883c6456352c4e61688` |
| index | 63 | `a7864b346fe4bf1502318cf596c4c947` |
| policy | 94 | `c780e6961f93d8bb6447c4df9519e6ee` |
| rls | 22 | `c3e064a7347e8cbfa1474e73e399decf` |
| trigger | 23 | `bfa683db9a6d8bbfe8574deaa7299e34` |
| view | 1 | `a4caa190c292956c0b4cd7a4fd2fda36` |

### Como utilizar na comparação

Após restaurar com êxito o backup atual em **quarto** PostgreSQL local, executar a **mesma** consulta `schema_fingerprints_readonly.sql` no clone e comparar categorias. Um digest divergente orienta a inspeção de DDL local vs remoto; um digest idêntico **não prova** dados iguais, permissões fora da ACL da relação, extensões, Storage binário, configurações de Auth, chaves, versões de Edge Functions nem segurança de login.

As condições essenciais de liberação seguem abertas: primeira recuperação concluída e validada, migrações conciliadas, superadministrador legítimo confirmado, proteção contra senhas vazadas, teste end-to-end de reservas/multiempresa, Asaas Sandbox (reembolso `DONE` + `REFUNDED`) e operação/suporte.

**Nenhum dado/DDL remoto foi escrito durante este inventário.**
