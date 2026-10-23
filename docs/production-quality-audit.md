# Auditoria de qualidade — Orbit Agenda

Data: 2026-10-23

## Correções implementadas
- Financeiro: eliminada limitação de 1.000 movimentações para que o resumo não apresente totais incompletos. Paginação ordenada por data de competência, criação e identificador.
- Pagamentos vinculados: consultas paginadas para verificar saldos sem truncamento quando há muitos lançamentos.
- Contas a receber: consulta todos os atendimentos concluídos por páginas; total exibido deixa de depender dos 500 primeiros registros.
- Datas financeiras: calendário inicial conforme fuso do estabelecimento; ao falhar a consulta, o extrato anterior é limpo em vez de mostrar números possivelmente desatualizados.
- Exportação do extrato em CSV com neutralização de fórmulas que poderiam ser introduzidas por conteúdo de clientes.
- Documentação geral atualizada e backup antigo removido da árvore atual de um repositório público, com padrões no .gitignore.
- Suítes Vitest/build e banco PostgreSQL descartável continuam como gates do PR.

## Revisões de segurança que permanecem
- Arquivo de backup **já existiu no histórico Git público**: removê-lo da branch atual não apaga o histórico; é preciso revisar se havia informação secreta e, se houver, revogar/rotacionar a credencial e tratar a remoção do histórico com cuidado.
- Migrações aplicadas manualmente ao Supabase ainda possuem divergências do histórico da CLI. Não executar db push em produção até reconciliar com equivalência comprovada e teste de restauração de backup.
- A proteção contra senhas vazadas no Supabase Auth segue como aviso de configuração e exige habilitação no painel quando disponível.
- Funções SECURITY DEFINER autenticadas são necessárias para criação de estabelecimento, fechamento/reabertura de caixa, consulta de superadministrador e repasses. Rever papéis e autorizações sem desativar às cegas.
- Testes de banco verificam parte do isolamento de inquilinos, mas não substituem testes de aceitação no navegador com contas de proprietário, funcionário e superadministrador reais.
- Nada nesta revisão adiciona cobrança recorrente por assinatura nem pagamentos externos reais.

## Próximas ações recomendadas
- Validar financeiramente com um estabelecimento de homologação que tenha mais de 1.000 lançamentos, garantindo correspondência entre CSV, painel e consultas SQL.
- Criar uma rotina periódica de backup com teste efetivo de restauração.
- Habilitar proteção de senhas comprometidas em Auth.
- Definir regras comerciais dos planos antes de automatizar assinatura/bloqueio de acesso.
