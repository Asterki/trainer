FROM node:22-bookworm AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json openapi.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV DB_PATH=/data/trainer.db
ENV PORT=8787
ENV TRAINER_TIMEZONE=UTC
ENV SYNC_RETENTION_DAYS=365
ENV MCP_ENABLED=false
ENV CORS_ORIGINS=
ENV API_CORS_ORIGINS=
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "dist/index.js"]
