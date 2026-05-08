FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Prod-only deps. Kept in its own stage so the runtime image stays
# corepack/pnpm-free — no package manager runs as PID 1, no corepack
# tries to download to a missing per-user cache.
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
RUN adduser -u 1001 -D appuser
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
RUN mkdir -p /db && chown appuser:appuser /db
USER appuser
EXPOSE 3000
# Direct node invocation — no pnpm/corepack at runtime. The bin
# symlink resolves to @react-router/serve/bin.js which is itself a
# node entrypoint (#!/usr/bin/env node).
CMD ["node", "./node_modules/.bin/react-router-serve", "./build/server/index.js"]
