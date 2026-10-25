# OrbitAgenda — WhatsApp para barbearias SEM computador

**Situação:** implementação em PR de homologação, não instalada na nuvem e não ativada para clientes. O piloto local continua em produção na branch main e funciona no Docker da desenvolvedora. **Não publicar esta feature só com o código:** ela depende de backend permanente e testes de pareamento.

## A experiência do cliente

1. No celular, o dono abre **OrbitAgenda > WhatsApp Automático**.
2. Informa o número da própria barbearia e toca em **Conectar pelo celular**.
3. O backend hospedado (não o computador do dono) cria uma instância dedicada. O painel mostra código temporário da Evolution API caso a versão permita pareamento por número.
4. No WhatsApp principal, entra em **Dispositivos conectados > Conectar dispositivo > Conectar com número de telefone**, confirma que reconhece a solicitação e informa o código. O fluxo pode variar conforme a versão do WhatsApp. Se o código não for oferecido, o sistema tem fallback de QR, que requer outro aparelho para leitura.
5. Quando estiver conectado, ativa notificações; o cliente do salão deve marcar a autorização opcional na reserva para receber WhatsApp.

**O cliente não instala Docker, PowerShell, nem precisa deixar computador ligado.** O servidor central assume esse trabalho. A conexão não oficial pode se desconectar e estar sujeita a bloqueios. O pareamento por código da Evolution API v2.3.7 ainda precisa de teste E2E com WhatsApp Business; não prometer que funcione para toda conta.

Fontes: [WhatsApp — como conectar pelo número](https://faq.whatsapp.com/1324084875126592/) e [Evolution API — Instance Connect](https://docs.evoapicloud.com/api-reference/instance-controller/instance-connect).

## Arquitetura proposta

O arquivo **`ops/render-whatsapp/render.yaml` é um Blueprint ainda NÃO sincronizado no Render**.

- Render **private service**: Evolution API v2.3.7 com disco persistente para sessões, sem endpoint público.
- Render **Postgres pago**: banco da Evolution API; separado do Supabase (o Supabase continua sendo o banco principal do SaaS).
- Render **Key Value pago**: Redis compatível para cache interno; sem acesso público.
- Render **background worker**: `tools/whatsapp-cloud/worker.mjs`, sem porta de entrada; lê somente comandos do Supabase e fala com a Evolution pelo endereço privado Render.
- Supabase Edge `whatsapp-cloud-worker` valida **ORBIT_WHATSAPP_CLOUD_SECRET** (segredo de 64 caracteres hex, igual no Render e no Supabase). Só a Edge mantém a chave de serviço do banco; o Render usa a chave publishable junto ao segredo específico da ponte.
- SQL `20261025183000_whatsapp_cloud_mobile.sql`: funções de backend restritas a `service_role`, e função de conexão de celular restrita ao proprietário. A conexão é marcada `backend='cloud'`. O sistema existente `backend='local'` não deve ser migrado sem confirmação.

**Segurança:** não disponibilizar API key da Evolution no navegador, não publicar a instância privada na internet, não deixar usuários criarem conexão de outra empresa, não permitir envios sem consentimento do cliente e do proprietário. Código temporário e QR pertencem apenas ao estabelecimento graças a RLS. Jobs marcados `sending` não são repetidos automaticamente após timeout incerto.

## Custos e aprovação necessária

A Evolution API pode ser usada sem tarifa por mensagem, **mas não há como garantir um servidor gratuito 24 horas no Render**: Free Web Services hibernam; Free PostgreSQL expira após 30 dias e Free Key Value não persiste dados após reiniciar. Veja a [documentação oficial Render Free](https://render.com/docs/free) e [preços](https://render.com/pricing).

O Blueprint propõe recursos **pagos** separados dos serviços `manto` e `CTPRIME` existentes. **Não sincronizar** sem confirmar orçamento mensal no painel Render. Não reutilize servidores de outros clientes e não crie banco gratuito de 30 dias para contas comerciais de WhatsApp.

## Checklist obrigatório antes de habilitar

- [ ] CI SQL + TypeScript + Blueprint yaml aprovados; validar Blueprint com Render CLI >= 2.7.0: `render blueprints validate ops/render-whatsapp/render.yaml`.
- [ ] Conferir custo mensal de cada serviço, banco, Key Value e disco no Render; obter autorização para recursos pagos.
- [ ] Preparar migração em banco isolado e validar contra o Supabase real, sem `supabase db push` cego por causa do drift anterior.
- [ ] Prover Render Blueprint do GitHub, sem alterar serviços existentes, e testar rede privada entre worker e Evolution.
- [ ] Criar segredo aleatório 64-hex e configurá-lo SOMENTE em Render worker e Supabase Edge secrets como `ORBIT_WHATSAPP_CLOUD_SECRET`; configurar publishable key do Supabase via Render Secret. Nunca colocar segredo no GitHub/Frontend.
- [ ] Implantar a Edge Function com `verify_jwt=false` mas verificação obrigatória do segredo no código; antes do segredo deve responder 503; com segredo errado 403; jamais expor mensagens por engano.
- [ ] Testar leitura do código temporário pelo WhatsApp Business em **um celular só**, com autorização expressa do titular. Validar fallback QR e expiração.
- [ ] Testar múltiplas empresas e a troca de número, isolamento, reconexão após restart, opt-in, opt-out, re-agendamento/cancelamento, fila e ausência de duplicações.
- [ ] **Só depois** habilitar `VITE_WHATSAPP_CLOUD_ENABLED=true` no frontend Vercel e publicar. O padrão é `false`; não afeta o piloto atual.
- [ ] Preparar monitoração de falhas, limites de envios e política de uso/risco antes de comercializar.

## Limitações do protótipo

A lista de empresas cloud está limitada a 100 conexões por ciclo; se crescer, haverá necessidade de paginação e escalonamento. O provedor não comprova entrega quando aceita uma mensagem. Alterações no número revogam a instância anterior no OrbitAgenda, mas a sessão antiga deve ser invalidada junto à Evolution/WhatsApp em um processo de limpeza auditado. Nenhuma dessas migrações está ativa no banco de produção.

