# gryt-ai-chat-bot

Bot para o servidor Gryt. Ao receber `@AI Chat` em um canal, cria uma thread e responde nela. Também adota uma thread existente quando recebe uma menção nela. As respostas seguintes permanecem na mesma conversa, que é retomada após reinício.

## Implantação

1. Copie esta pasta para o host Gryt, por exemplo em `/opt/gryt-ai-chat-bot`.
2. Crie `.env` com `GRYT_HOST=https://gryt.leonardson.com.br`. O nome padrão é `AI Chat`; personalize com `GRYT_NICKNAME`. O provider padrão é Codex, com `gpt-6-luna` como modelo econômico padrão. Defina `ASSISTANT_MODEL` para escolher o modelo usado na próxima resposta de qualquer conversa. Para usar OpenAI, defina `ASSISTANT_PROVIDER=openai`, opcionalmente `ASSISTANT_MODEL` (padrão `gpt-4.1-mini`) e `OPENAI_API_KEY`. Para OpenRouter, defina `ASSISTANT_PROVIDER=openrouter`, opcionalmente `ASSISTANT_MODEL` (padrão gratuito `openrouter/free`) e `OPENROUTER_API_KEY`.
3. Execute `docker compose up -d --build`.
4. No Gryt, abra **Server settings → Bots** e aprove `AI Chat` com `read_messages` e `send_messages`.
5. Para Codex, conclua o login no container com `docker exec -it gryt-ai-chat-bot codex login --device-auth`. Para OpenAI, forneça `OPENAI_API_KEY`; para OpenRouter, forneça `OPENROUTER_API_KEY` no ambiente do container.
6. Use `@AI Chat` num canal de texto para iniciar. A primeira execução pode levar alguns segundos.

Em instalações Docker Compose antigas, renomeie `CODEX_MODEL` para `ASSISTANT_MODEL` no `.env`. Ao executar Node diretamente, `CODEX_MODEL` continua aceito como fallback para Codex; `ASSISTANT_MODEL` tem prioridade.

Por padrão, `HISTORY_CACHE_ENABLED=false`: a cada nova mensagem, o bot relê a raiz e todas as respostas anteriores da thread no Gryt, com paginação, e cria uma sessão de resposta usando esse contexto. Isso também funciona sem uma nova menção em threads onde o bot já participou ou foi mencionado. Não há cache local de mensagens; as sessões Codex são efêmeras e liberadas após a resposta. A identidade e a autenticação do bot continuam no volume Docker.

Para reduzir as leituras do Gryt, ative o cache opcional com `HISTORY_CACHE_ENABLED=true`. O histórico fica em `/data/conversations.json`, e `HISTORY_TTL_HOURS` define seu prazo (padrão: 168 horas, ou 7 dias). O prazo começa quando a thread é carregada no cache e **não é renovado por novas respostas**. Sem cache válido, o bot relê a thread. A limpeza ocorre na inicialização e a cada minuto; registros vencidos deixam de ser usados imediatamente. Backups e registros Codex nativos antigos também são removidos conforme o TTL. Registros antigos sem expiração são descartados.

Ao desativar o cache, o bot remove os arquivos locais de histórico e backups anteriores, além dos registros nativos persistentes antigos do Codex. A autenticação é preservada. Essa configuração não apaga mensagens do servidor Gryt: elas permanecem na origem e são lidas novamente para reconstruir o contexto.

O histórico de texto é comum aos providers. Após recriar o container, alterações em `ASSISTANT_PROVIDER` ou `ASSISTANT_MODEL` passam a valer na próxima resposta, inclusive em threads existentes. Quando o cache está ativado, uma sessão nativa perdida é recriada usando o contexto recuperado. O Codex usa sessões efêmeras para evitar novas cópias permanentes de conversas; registros nativos antigos, ativos ou arquivados, são removidos imediatamente com o cache desativado, ou pelo TTL contado da criação quando o cache está ativo. A autenticação Codex é preservada. Resultados internos de ferramentas e raciocínio não fazem parte do histórico compartilhado.

O Gryt fixa o nome da identidade quando ela é aprovada. Para renomear uma identidade já aprovada, é preciso registrar e aprovar uma identidade nova em **Server settings → Bots**.

## Operação

- `docker compose logs -f gryt-ai-chat-bot` acompanha a conexão e erros.
- Reinicie com `docker compose restart gryt-ai-chat-bot`.
- Atualizações de imagem/código: `docker compose up -d --build`.
- Para sair da conta Codex, revogue a conexão nas configurações do ChatGPT e limpe somente a sessão em `gryt-ai-chat-bot-data:/data/codex` (isso não remove a identidade do bot).

## Limites de segurança e uso

O bot pede leitura e envio de mensagens no Gryt, além da permissão opcional `upload_avatar_image` para atualizar o avatar. O provider Codex tem busca na web habilitada com `web_search = "live"` em `config.toml`, para consultar informações atuais. O acesso à rede por comandos permanece desabilitado no perfil `gryt_chat`. O provider OpenAI envia mensagens e instruções pela API Responses. O provider OpenRouter envia o histórico da conversa pela API Chat Completions. O serviço não oferece comandos para administrar o Gryt.

Com Codex, as mensagens consomem o uso da conta ChatGPT autenticada no container. OpenAI e OpenRouter usam suas respectivas chaves e limites de API. No OpenRouter, `openrouter/free` seleciona modelos gratuitos disponíveis; um modelo definido explicitamente em `ASSISTANT_MODEL` pode ter cobrança. Quem tiver acesso ao servidor pode acionar o bot. A identidade Codex e as chaves de API não devem ser incluídas em backups compartilhados ou logs.

## Desenvolvimento

Execute `npm test` para validar os fluxos de conversa sem credenciais. Providers implementam `start()`, `createSession({ model, instructions })`, `reply({ session, messages, signal })` e `stop()`; sessões são opacas pelo serviço. O adaptador Codex também limpa registros nativos antigos e libera sessões efêmeras vencidas. O CLI permanece instalado para executar essa limpeza mesmo quando outro provider estiver selecionado. O volume de autenticação Codex é exclusivo deste bot; a política de retenção também se aplica às sessões nativas nele armazenadas.
