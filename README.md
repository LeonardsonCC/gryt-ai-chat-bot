# Gryt AI Chat Bot

An AI conversation bot for Gryt with Codex, OpenAI, and OpenRouter support. Mention `@AI Chat` in a text channel to start a thread, or mention it in an existing thread to bring it into the conversation. Follow-up replies stay in that thread, and conversation context can be recovered after a restart.

- Choose a provider and model for new and existing conversations.
- Rebuild context from Gryt thread history, with an optional disk cache.
- Keep bot identity and authentication across container recreations.
- Process messages in order within each conversation.

## Requirements

- A Gryt server where you can approve bots.
- Docker Engine and Docker Compose.
- A ChatGPT account for the Codex provider, or an API key for OpenAI or OpenRouter.

## Quick start

### 1. Configure the bot

```sh
git clone https://github.com/LeonardsonCC/gryt-ai-chat-bot.git
cd gryt-ai-chat-bot
cp .env.example .env
```

Edit `.env` and set your Gryt server address:

```dotenv
GRYT_HOST=https://gryt.example.com
GRYT_NICKNAME=AI Chat
ASSISTANT_PROVIDER=codex
ASSISTANT_MODEL=gpt-6-luna
```

Codex is the default provider. To use an API provider instead, see [Providers](#providers).

### 2. Create the volume and start the bot

The Compose file uses an external volume. Create it once before the first startup; existing installations can reuse the same volume.

```sh
docker volume create gryt-ai-chat-bot_gryt-ai-chat-bot-data
docker compose up -d --build
```

### 3. Approve the bot in Gryt

Open **Server settings → Bots** and approve `AI Chat` with `read_messages` and `send_messages`. Grant the optional `upload_avatar_image` permission if you want the bot to set its bundled avatar.

### 4. Authenticate the provider

For Codex, start the device login flow in the running container:

```sh
docker exec -it gryt-ai-chat-bot codex login --device-auth
```

Open the URL shown, enter the code, and sign in with your ChatGPT account. Check the result with:

```sh
docker exec -it gryt-ai-chat-bot codex login status
```

For OpenAI or OpenRouter, set the corresponding API key in `.env` before starting the container. The Codex login step applies only when using Codex.

### 5. Start a conversation

Send a message such as `@AI Chat explain how this works` in a Gryt text channel. The bot creates a thread and replies there. Continue replying in that thread without repeating the mention.

You can also mention the bot in an existing thread. It reads the thread context before answering. The first response may take a few seconds.

## Providers

The defaults below come from this repository's configuration.

| `ASSISTANT_PROVIDER` | Default model | Authentication |
| --- | --- | --- |
| `codex` | `gpt-6-luna` | ChatGPT login inside the container |
| `openai` | `gpt-4.1-mini` | `OPENAI_API_KEY` |
| `openrouter` | `openrouter/free` | `OPENROUTER_API_KEY` |

Set `ASSISTANT_MODEL` to override the selected provider's default. When switching providers, also update or clear the model setting copied from `.env.example`.

For example, to use OpenAI, set:

```dotenv
ASSISTANT_PROVIDER=openai
ASSISTANT_MODEL=gpt-4.1-mini
OPENAI_API_KEY=replace-with-your-api-key
```

For OpenRouter, set:

```dotenv
ASSISTANT_PROVIDER=openrouter
ASSISTANT_MODEL=openrouter/free
OPENROUTER_API_KEY=replace-with-your-api-key
```

After editing `.env`, recreate the container to apply the changes:

```sh
docker compose up -d --build
```

The new provider and model are used on the next reply, including in existing threads. Shared context contains conversation text; it excludes internal tool results and reasoning.

For older deployments, rename `CODEX_MODEL` to `ASSISTANT_MODEL` in `.env`. When running Node directly, `CODEX_MODEL` remains a Codex fallback, with `ASSISTANT_MODEL` taking precedence.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GRYT_HOST` | Required by Compose | Gryt server address |
| `GRYT_NICKNAME` | `AI Chat` | Bot name and mention text |
| `ASSISTANT_PROVIDER` | `codex` | Provider to use for replies |
| `ASSISTANT_MODEL` | Provider default | Model override |
| `OPENAI_API_KEY` | Empty | Required for the OpenAI provider |
| `OPENROUTER_API_KEY` | Empty | Required for the OpenRouter provider |
| `HISTORY_CACHE_ENABLED` | `false` | Enable a local conversation cache |
| `HISTORY_TTL_HOURS` | `168` | Cache lifetime in hours when enabled |

Gryt fixes an identity's name when it is approved. Renaming an approved bot requires registering and approving a new identity in **Server settings → Bots**.

## Conversation history and retention

Gryt is the source of conversation history. With the default `HISTORY_CACHE_ENABLED=false`, the bot reads the thread root and previous replies from Gryt on every response, following pagination. It recognizes threads where it has already participated or been mentioned, including after a restart. Codex sessions are ephemeral and released after each response in this mode.

Set `HISTORY_CACHE_ENABLED=true` to reduce reads from Gryt. The bot stores the cache in `/data/conversations.json`. `HISTORY_TTL_HOURS` defaults to 168 hours (7 days), measured from when the thread is loaded into the cache. New replies do not extend that deadline. Once the cache expires, the next message reloads the thread from Gryt. A lost provider session is recreated from the recovered text context.

Cleanup runs at startup and at least once a minute. Expired cache records stop being used immediately. Old cache backups and legacy persistent Codex sessions, including archived sessions, are also subject to retention. Legacy cache records without an expiration are discarded; legacy Codex session retention is measured from creation.

Disabling the cache removes local conversation cache files, backups, and legacy persistent Codex sessions. Bot identity and Codex authentication are preserved. Messages stored on the Gryt server remain available to rebuild context.

The `/data/codex` directory is dedicated to this bot. Its retention policy applies to native Codex sessions stored there, so do not share it with another Codex installation.

## Operations

| Task | Command |
| --- | --- |
| Follow logs | `docker compose logs -f gryt-ai-chat-bot` |
| Check container status | `docker compose ps` |
| Restart the bot | `docker compose restart gryt-ai-chat-bot` |
| Apply code or environment changes | `docker compose up -d --build` |
| Stop the bot | `docker compose down` |

Bot identity and Codex authentication live in the external Docker volume mounted at `/data` and survive container recreation. Preserve this volume when updating the bot.

To disconnect the ChatGPT account, revoke the connection in ChatGPT settings and clear only the Codex authentication stored under `/data/codex`. Preserve `/data/ai-chat-bot-identity.json` to keep the approved Gryt identity.

## Access and data handling

The bot requests message read/send permissions and optional avatar upload permission. It does not provide Gryt administration commands. Server members who can reach the bot can trigger provider usage.

Conversation text is sent to the selected provider. Codex uses the authenticated ChatGPT account; OpenAI and OpenRouter use their respective API keys and usage limits. The OpenRouter default is the `openrouter/free` route; selecting another model may incur charges.

The bundled Codex configuration enables live web search. Its `gryt_chat` permission profile grants read access to `/tmp/gryt-ai-chat-bot` and disables network access through commands. The Compose service also grants `SYS_ADMIN` and disables the default seccomp and AppArmor profiles; review these settings for your deployment.

Keep `.env`, API keys, bot identity, and Codex authentication out of Git, shared backups, and logs. The repository includes Git exclusions for common credential files and a Docker build context allowlist.

## Development

Use Node.js 22.13 or newer. Install dependencies and run the tests:

```sh
npm install
npm test
```

The test suite runs without provider credentials. The Docker image includes the Codex CLI even when another provider is selected, because startup and periodic cleanup use it to remove legacy Codex sessions.

Providers implement `start()`, `createSession({ model, instructions })`, `reply({ session, messages, signal })`, and `stop()`. The conversation service treats provider sessions as opaque values. The Codex adapter additionally releases ephemeral sessions and prunes legacy native history.

## License

[MIT](LICENSE)
