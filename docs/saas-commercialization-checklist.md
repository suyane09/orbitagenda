# Comercialização do Orbit Agenda

## O que está instalado
- Cada empresa continua isolada pelo Supabase RLS, com seu cadastro e painel.
- Central da plataforma em `/plataforma` permite criar **planos internos** com nome e valor mensal escolhido pelo administrador; preços não são inventados.
- O superadministrador pode vincular um estabelecimento a um plano e definir seu status contratual (`trialing`, `active`, `past_due`, `suspended`, `canceled`).
- Proprietários consultam o plano em `/app/assinatura`. Funcionários não veem os contratos.
- Tabelas não concedem escrita direta ao `anon` ou `authenticated`. Apenas RPCs privilegiadas validam `private.is_superadmin()`, com `search_path` fixo e teste de negação por RLS.
- Sem subscrição atribuída, o painel deixa isso claro e não cria cobrança.

## Limitações deliberadas
**Não há cobrança real ainda.** O sistema não criou assinatura no Asaas, não gera Pix nem boleto, não registra pagamento como recebido, não aplica renovação recorrente, não verifica webhooks e não bloqueia acesso dos clientes quando um contrato vence. Os status desta versão são lançamentos administrativos, não prova de pagamento.

Antes de cobrar clientes:
1. Escolher o gateway (por exemplo, Asaas) e validar titularidade, planos, periodicidade, prazo de tolerância, regras de cancelamento e emissão de nota.
2. Criar a integração segura backend-to-backend, com chave guardada nos segredos do servidor (nunca VITE_*), idempotência e webhooks autenticados.
3. Testar pagamento aprovado, pagamento não realizado, atraso, recuperação, reembolso e fraude no ambiente de sandbox.
4. Implementar no servidor os critérios de bloqueio por assinatura, com modo de recuperação e sem apagar dados.
5. Conciliar as versões SQL antigas manualmente aplicadas (ver `docs/migration-reconciliation.md`) somente após backup **testado** e equivalência validada.

## Configuração Supabase
- O Security Advisor ainda aponta proteção de senhas vazadas não ativada. Habilitar **Leaked Password Protection** nas configurações de Auth se o plano permitir; a integração disponível no chat não expõe essa configuração.
- Não executar `supabase db push` antes de reconciliar o histórico da CLI.
- Os alertas sobre funções `SECURITY DEFINER` incluem RPCs necessárias à gestão e exigem análise de risco, não remoção cega.

## Operação e testes
A suíte PostgreSQL descartável cobre acesso do proprietário, usuário de outra empresa, superadministrador e falta de privilégios de escrita direta. Para aceitação final, validar navegação e cadastro real no navegador, em computador e celular.
