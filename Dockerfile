FROM node:22-alpine
RUN npm install --global @openai/codex
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY avatar.png /app/avatar.png
COPY config.toml /app/config.toml
ENV GRYT_IDENTITY_PATH=/data/gryt-bot-identity.json
ENV CODEX_HOME=/data/codex
ENV CODEX_MODEL=gpt-6-luna
VOLUME ["/data"]
RUN mkdir -p /data/codex /tmp/gryt-codex && chown -R node:node /data /tmp/gryt-codex /app
USER node
CMD ["sh", "-c", "cp /app/config.toml \"$CODEX_HOME/config.toml\" && exec node src/index.js"]
