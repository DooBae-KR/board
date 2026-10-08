FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    TOKENS_FILE=/data/tokens.json \
    REPOS_FILE=/data/repos.json
COPY package.json ./
COPY src ./src
# 기본(시드) 파일: 볼륨의 /data/repos.json이 없을 때 최초 1회만 복사됨
COPY data/repos.json ./data/repos.json
COPY scripts ./scripts
COPY .claude/agents ./.claude/agents
# 하네스: 에이전트 정의(시작 시 Supabase 동기화), Substrate 매니페스트(정의 검증용), 모션 컴포지션
COPY agents ./agents
COPY substrate ./substrate
COPY motion ./motion
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1
CMD ["node", "src/server.js"]
