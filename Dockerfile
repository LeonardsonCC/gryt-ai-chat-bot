FROM node:22-alpine
ARG ASSISTANT_PROVIDER=codex
RUN npm install --global @openai/codex
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY avatar.png /app/avatar.png
COPY config.toml /app/config.toml
ENV GRYT_IDENTITY_PATH=/data/ai-chat-bot-identity.json
ENV CODEX_HOME=/data/codex
ENV ASSISTANT_PROVIDER=${ASSISTANT_PROVIDER}
VOLUME ["/data"]
RUN mkdir -p /data/codex /tmp/gryt-ai-chat-bot && chown -R node:node /data /tmp/gryt-ai-chat-bot /app
USER node
CMD ["sh", "-c", "if [ \"$ASSISTANT_PROVIDER\" = codex ]; then cp /app/config.toml \"$CODEX_HOME/config.toml\"; fi; exec node src/index.js"]
