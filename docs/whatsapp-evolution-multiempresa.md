# OrbitAgenda: WhatsApp automático multiempresa (piloto, Evolution API)

Estado: código em desenvolvimento/homologação. Não ativar para clientes até testes de segurança, QR por empresa e agendamento real passarem. Evolution API v2.3.7 usa integração não oficial Baileys: sem tarifa por mensagem, com risco de bloqueio, sessão perdida e custo de eletricidade/hospedagem. Docker e Node worker devem permanecer ligados para realizar envios.

## Arquitetura
1. Proprietário abre `/app/whatsapp` (superadmin com estabelecimento próprio pode usar `/plataforma/whatsapp-teste`). O painel usa RLS por empresa.
2. Clica **Conectar WhatsApp**. RPC autenticada cria código aleatório de 64 hex, uso único/10 minutos, e revoga token anterior. Copiar o código sem publicar.
3. No computador que hospeda a Evolution API, executar `node worker.mjs pair CODIGO`. O worker envia o código para a Edge Function `whatsapp-worker`, que rate-limita, executa RPC com privilégio de serviço e devolve token por estabelecimento de uso exclusivo daquele worker. O token é armazenado somente em `.workers/oa_...json` local (ignorado pelo Git).
4. Executar `node worker.mjs run`. O processo acessa apenas HTTPS Supabase para buscar tarefas e localhost:8088 para falar com a Evolution. Nenhuma porta de entrada pública é necessária.
5. QR temporário surge no painel do proprietário. Escanear pelo WhatsApp daquela barbearia. Então botão **Ativar envios**.
6. Cliente marca checkbox opcional de WhatsApp na reserva pública. A Edge Function `public-booking`, após CAPTCHA e criação, grava consentimento. O banco enfileira confirmação imediatamente e lembrete até 24h ou 2h antes do compromisso; cancelamentos/reagendamentos atualizam a fila.
7. O worker só solicita jobs se a conexão estiver online E o proprietário tiver ativado. Envia mensagens individualmente pela instância da barbearia; grava apenas **aceito pela API**, não confunde aceite com entrega.
8. Um único processo Node suporta várias barbearias com tokens e instâncias distintas, cada uma com seu QR.

## Instalação local (depois de publicar migração/Edge/UI)

O piloto já testado em Docker está na pasta do Windows `$HOME\orbitagenda-whatsapp-teste`. Não apague nem recrie o ambiente. Atualize somente o novo arquivo:

```powershell
cd "$HOME\orbitagenda-whatsapp-teste"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/suyane09/orbitagenda/main/tools/whatsapp-local/worker.mjs" -OutFile ".\worker.mjs" -UseBasicParsing
```

No arquivo `.env` local (junto a `AUTHENTICATION_API_KEY` e `POSTGRES_PASSWORD` existentes), acrescentar:
```env
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_SUA_CHAVE_PUBLICA
```
A chave publishable pode ser obtida em Supabase → Project Settings → API Keys. Nunca use `sb_secret`, `service_role` ou chave de banco nesta máquina/arquivo, nem copie a chave local Evolution para o frontend.

Em seguida, na conta proprietária, gerar o código. Executar:
```powershell
node .\worker.mjs pair CODIGO_DE_64_CARACTERES
node .\worker.mjs run
```
Deixe esta janela aberta e o Docker Desktop funcionando. Para outra barbearia, gere outro código e execute `node .\worker.mjs pair NOVO_CODIGO` em **outra janela**; o mesmo processo `run` lerá todos os perfis. Nunca divulgue `.workers`, QR ou arquivos de sessão.

**Não confundir com `orbitagenda_teste`**, instância da prova local anterior: cada empresa usa `oa_<establishment_uuid>`, portanto precisa de nova leitura do QR. Não enviar mensagens até conectar a nova instância e ativar explicitamente.

## Dependências de publicação

1. Aplicar somente a migração aditiva validada `20261025153631_whatsapp_saas_outbound_pilot.sql` (o histórico remoto de migrações diverge; não usar db push cego).
2. Implantar a nova Edge Function `whatsapp-worker` com `verify_jwt=false` e validação `withSupabase({auth:['publishable']})`; a própria função só libera as ações permitidas e é protegida por token individual e rate limiting. A implantação com JWT habilitado fará o worker falhar.
3. Implantar a alteração da Edge Function preexistente `public-booking` para gravar opt-in, preservando segredo Turnstile, antiabuso, gateway e rotas anteriores.
4. Atualizar o frontend após CI e confirmar login tanto de dono normal como superadmin.
5. Validar isolamento A/B, processo parado, cancelamento, consentimento desmarcado, expiração e revogação de pareamento e agendamento real.

## Comportamentos deliberados
- Opt-in desmarcado por padrão; nenhum envio automático sem consentimento e sem dono ativar.
- Não há automação de marketing, IA, disparos em massa ou respostas automáticas.
- Nenhuma tentativa automática de reenvio em caso de resposta incerta, evitando duplicação. Jobs podem permanecer `sending` e exigem análise.
- Se o usuário cancelar ou remarcar, só jobs em `queued` são cancelados; mensagens já aceitas não são apagáveis.
- Se o PC estiver desligado na hora do agendamento, o envio fica pendente; não há SLA de entrega.
- Os dados das mensagens são privados por RLS, mas o prestador do worker local terá acesso aos corpos das mensagens daquela empresa. Use computador confiável e cumpra LGPD.
- Não expor as portas locais do Docker por túnel, Cloudflare Tunnel ou port forwarding para produzir envios.
