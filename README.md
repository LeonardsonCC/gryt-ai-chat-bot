# Gryt Codex Bot

Bot autônomo para o servidor Gryt. Ao receber `@Codex` em um canal de texto, cria uma thread a partir da mensagem e responde nela. Depois disso, responde às novas mensagens nessa thread, mantendo uma conversa Codex separada por thread do Gryt.

## Implantação

1. Copie esta pasta para o host Gryt, por exemplo em `/home/akami/dev/gryt-codex-bot`.
2. Crie `.env` com `GRYT_HOST=https://gryt.leonardson.com.br` e, se desejar, ajuste `GRYT_NICKNAME` e `CODEX_MODEL` (padrão: `gpt-6-luna`).
3. Execute `docker compose up -d --build`.
4. No Gryt, abra **Server settings → Bots** e aprove `Codex` com `read_messages` e `send_messages`.
5. Conclua o login ChatGPT no container com `docker exec -it gryt-codex-bot codex login --device-auth`. Abra o endereço indicado, autentique na conta Pro desejada e informe o código de dispositivo.
6. Use `@Codex` num canal de texto para iniciar. A primeira execução pode levar alguns segundos.

O volume `gryt-codex-data` guarda a identidade do bot, a autenticação Codex e o vínculo persistente entre threads Gryt e Codex. Não apague esse volume: perder a identidade exige nova aprovação no Gryt; perder a sessão Codex exige novo login.

## Operação

- `docker compose logs -f gryt-codex-bot` acompanha a conexão e erros.
- Reinicie com `docker compose restart gryt-codex-bot`.
- Atualizações de imagem/código: `docker compose up -d --build`.
- Para sair da conta Codex, revogue a conexão nas configurações do ChatGPT e limpe somente a sessão em `gryt-codex-data:/data/codex` (isso não remove a identidade do bot).

## Limites de segurança e uso

O bot pede somente leitura e envio de mensagens no Gryt. O Codex recebe apenas o texto da conversa; o app-server inicia em contexto de leitura restrita, sem acesso a arquivos do host ou ferramentas de escrita. O serviço não oferece comandos para administrar o Gryt.

As mensagens são processadas usando a conta ChatGPT autenticada no container e consomem o uso incluído nessa conta. Quem tiver acesso ao servidor pode acionar o bot; acompanhe os limites de uso do app/conta em ChatGPT. A identidade Codex fica no volume local e não deve ser incluída em backups compartilhados ou logs.
