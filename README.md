# gryt-ai-chat-bot

Bot para o servidor Gryt. Ao receber `@AI Chat` em um canal, cria uma thread e responde nela. Também adota uma thread existente quando recebe uma menção nela. As respostas seguintes permanecem na mesma conversa, que é retomada após reinício.

## Implantação

1. Copie esta pasta para o host Gryt, por exemplo em `/opt/gryt-ai-chat-bot`.
2. Crie `.env` com `GRYT_HOST=https://gryt.leonardson.com.br`. O nome padrão é `AI Chat`; personalize com `GRYT_NICKNAME`. O provider padrão é Codex, com `gpt-6-luna` como modelo econômico padrão. Defina `ASSISTANT_MODEL` para escolher outro modelo para novas conversas. `CODEX_MODEL` continua aceito para compatibilidade com a configuração Codex anterior. Para usar OpenAI, defina `ASSISTANT_PROVIDER=openai`, opcionalmente `ASSISTANT_MODEL` (padrão `gpt-4.1-mini`) e `OPENAI_API_KEY`.
3. Execute `docker compose up -d --build`.
4. No Gryt, abra **Server settings → Bots** e aprove `AI Chat` com `read_messages` e `send_messages`.
5. Para Codex, conclua o login no container com `docker exec -it gryt-ai-chat-bot codex login --device-auth`. Para OpenAI, forneça `OPENAI_API_KEY` no ambiente do container.
6. Use `@AI Chat` num canal de texto para iniciar. A primeira execução pode levar alguns segundos.

O volume `gryt-ai-chat-bot-data` guarda a identidade do bot, a autenticação Codex e registros versionados das conversas, incluindo provider, modelo, sessão e histórico quando necessário. Cada conversa fica vinculada ao modelo escolhido quando começou; alterações em `ASSISTANT_MODEL` só afetam conversas novas. O formato antigo é migrado na primeira inicialização e preservado em `conversations.json.bak`.

O Gryt fixa o nome da identidade quando ela é aprovada. Para renomear uma identidade já aprovada, é preciso registrar e aprovar uma identidade nova em **Server settings → Bots**.

## Operação

- `docker compose logs -f gryt-ai-chat-bot` acompanha a conexão e erros.
- Reinicie com `docker compose restart gryt-ai-chat-bot`.
- Atualizações de imagem/código: `docker compose up -d --build`.
- Para sair da conta Codex, revogue a conexão nas configurações do ChatGPT e limpe somente a sessão em `gryt-ai-chat-bot-data:/data/codex` (isso não remove a identidade do bot).

## Limites de segurança e uso

O bot pede leitura e envio de mensagens no Gryt, além da permissão opcional `upload_avatar_image` para atualizar o avatar. O provider Codex recebe o texto sem ferramentas habilitadas. O provider OpenAI envia mensagens e instruções pela API Responses. O serviço não oferece comandos para administrar o Gryt.

As mensagens são processadas usando a conta ChatGPT autenticada no container e consomem o uso incluído nessa conta. Quem tiver acesso ao servidor pode acionar o bot; acompanhe os limites de uso do app/conta em ChatGPT. A identidade Codex fica no volume local e não deve ser incluída em backups compartilhados ou logs.

## Desenvolvimento

Execute `npm test` para validar os fluxos de conversa sem credenciais. Providers implementam `start()`, `createSession({ model, instructions })`, `reply({ session, messages, signal })` e `stop()`; sessões são opacas pelo serviço.
