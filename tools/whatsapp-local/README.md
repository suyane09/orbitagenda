# OrbitAgenda — piloto local gratuito de WhatsApp (Evolution API)

Esta pasta contém **um ambiente de teste local** para conectar um único WhatsApp por QR Code e enviar uma mensagem de confirmação de teste. **Não** envia agendamentos reais automaticamente, não está conectado ao Supabase/Vercel, não está disponível para outras barbearias e não está pronto para produção. A integração multiempresa será feita depois de validar o piloto.

## Requisitos
- Windows 10/11 com **Docker Desktop aberto**, Linux containers habilitados
- Windows PowerShell 5.1+ (padrão no Windows 10)
- Internet para baixar imagens Docker e conectar ao WhatsApp
- O celular do titular do WhatsApp para autorizar um dispositivo vinculado

Não compartilhe o QR Code, senhas, arquivo `.env`, arquivos de sessões do Docker ou logs que contenham segredos. Não use WhatsApp de terceiros sem autorização. API baseada em WhatsApp Web/Baileys **não é oficial**, podendo causar desconexões ou restrições. Embora a API não cobre por mensagem, o Docker precisa ficar ligado e servidores externos para produção podem ter custo.

## Primeira conexão

Abra o PowerShell **dentro desta pasta** e execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testar.ps1 -Acao iniciar
```

A primeira execução:
1. Gera duas chaves aleatórias e guarda-as no `.env` LOCAL (ignorado pelo Git).
2. Sobe PostgreSQL, Redis e Evolution API v2.3.7 em volumes próprios. Só a API fica acessível em **127.0.0.1:8088**; não usa 8080, 5432 ou outras portas dos bancos do OrbitAgenda.
3. Cria a instância `orbitagenda_teste`.
4. Abre no navegador local um arquivo temporário que exibe o QR Code. O arquivo é excluído pelo script quando o status conectado é detectado.

No celular titular, abra **WhatsApp > Dispositivos conectados > Conectar dispositivo** e escaneie o QR. Se expirar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testar.ps1 -Acao qr
```

## Verificar e testar o envio (somente se tiver conectado)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testar.ps1 -Acao status
```

O status precisa ser `open`. Para enviar **UMA** mensagem, com consentimento e usando só um número sob seu controle, forneça explicitamente o destinatário com DDI 55 + DDD + número:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testar.ps1 -Acao enviar -Destino 55DDDNUMERO
```

O script ainda exigirá digitar a palavra **ENVIAR** antes de mandar. Ele não lê clientes do OrbitAgenda, não envia em massa e não automatiza agendamentos. O retorno HTTP de aceitação não comprova entrega; confira manualmente no WhatsApp.

Para parar apenas os contêineres deste piloto (sem apagar sessões):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testar.ps1 -Acao parar
```

## Diagnóstico quando o Docker está em execução mas o QR não abre

A porta TCP aberta (`Test-NetConnection 127.0.0.1 -Port 8088`) **não garante** que a API esteja pronta. Na Evolution API v2.3.7, uma chamada sem cabeçalho HTTP `Origin` pode receber `500 Not allowed by CORS`; o script passou a enviar `Origin: http://localhost:8088` em chamadas locais, conforme `CORS_ORIGIN` do Compose. Não é preciso definir CORS `*` nem reiniciar os containers. As versões anteriores do script testavam só o endpoint raiz e classificavam qualquer erro HTTP como “Docker desligado”. Na versão corrigida, o script usa a rota autenticada `/instance/fetchInstances` e mostra o código de erro sem imprimir a resposta, que poderia conter tokens de sessão.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\\testar.ps1 -Acao diagnostico
```

O diagnóstico mostra os estados dos contêineres, o código HTTP retornado pela raiz sem proxy e a situação resumida da rota autenticada. Se a rota autenticada estiver OK, execute `-Acao qr` novamente. Nunca cole conteúdo do `.env` ou respostas JSON da API em conversas públicas.

## Segurança e limitações

- Compose project fixo `orbitagenda-whatsapp-local`, volume persistente, porta da API limitada a loopback. Evite acesso público, túneis ou encaminhamento de porta.
- O segredo da Evolution API permanece no PowerShell local; não é enviado para frontend, Vercel, Supabase, console nem Git.
- **Não** use `docker compose down -v`: isso apagaria sessões e o banco da Evolution.
- API Evolution `evoapicloud/evolution-api:v2.3.7` (versão estável fixada); PostgreSQL e Redis dedicados.
- O WhatsApp pode exigir renovar o QR Code, atualizar a versão, desconectar o dispositivo ou impor restrições. Para clientes em produção, prefira WhatsApp Cloud API oficial da Meta.
- A etapa futura multiempresa precisa de backend público autenticado separado do frontend, segredos server-side, isolamento por `establishment_id`, opt-in, filas idempotentes, rate limiting, opt-out, observabilidade e políticas de privacidade. **Não publique este serviço local diretamente na internet.**

Fontes:
- https://github.com/evolution-foundation/evolution-api/releases
- https://github.com/evolution-foundation/evolution-api/blob/main/Docker/swarm/evolution_api_v2.yaml
- https://github.com/evolution-foundation/evolution-api/blob/main/.env.example
