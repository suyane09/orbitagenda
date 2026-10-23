# Comissões 2C — estado de produção e cuidados com migrations

> Verificado em 23/10/2026. Este documento é operacional; não executa SQL.

## Estado conferido

- Ambiente Supabase de produção: migração 2C já aplicada pelo SQL Editor.
- `public.appointment_commission_snapshots`: existe, RLS ativa e política de leitura para proprietário.
- `public.appointment_commission_balances`: VIEW `security_invoker=true`.
- `public.appointments`: gatilho `capture_appointment_commission` habilitado.
- Uma regra de comissão configurada: 40%; nenhum snapshot na data da verificação.
- A interface em `/app/comissoes` já consulta a VIEW e não registra repasses.
- Não há cálculo retroativo de atendimentos já concluídos.

## Atenção: histórico de migrações não reconciliado

O diretório `supabase/migrations` contém a migração antiga
`20261023200000_commission_accrual_review.sql` (2B).
O SQL Editor aplicou uma versão posterior **2C** à produção sem
registrá-la automaticamente no histórico da CLI.

Na conferência, `supabase_migrations.schema_migrations` não registrava
as migrações locais das 15h, 17h, 18h e 20h em 23/10 (somente a de 12h).
Assim, **não executar `supabase db push` diretamente**:
a CLI pode tentar reaplicar migrações já refletidas no esquema e falhar,
ou gerar divergências.

Antes de uma futura publicação de migrações:
1. Comparar estado real do banco com cada migration local pendente.
2. Manter a 2C validada como fonte de verdade para a lógica de comissões;
   não reaplicar 2B, nem reaplicar 2C sobre tabelas/view já existentes.
3. Revisar o plano de reconciliação do histórico da CLI em ambiente isolado
   e preservar backup testado, antes de alterar a tabela de histórico.
4. Realizar novo teste de integração com atendimento **de teste isolado**;
   não misturar dados fictícios com atendimentos de clientes.

## Comportamento esperado da 2C

Ao mudar um atendimento de não-concluído para `completed`, o gatilho
captura a regra vigente para aquele profissional. A VIEW calcula valores
sobre recebimentos (`income`) líquidos de estornos (`refund`), com
teto no preço do atendimento. Pagamentos parciais geram comissão parcial;
estornos podem reduzir a comissão apurada.

**Repasses aos profissionais não estão implementados** e não devem ser
inferidos do valor acumulado na tela.
