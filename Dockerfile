FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    TOKENS_FILE=/data/tokens.json
COPY package.json ./
COPY src ./src
COPY data/repos.json ./data/repos.json
COPY scripts ./scripts
COPY .claude/agents ./.claude/agents
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "src/server.js"]
