FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
RUN adduser -u 1001 -D appuser && corepack enable
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod
RUN mkdir -p /db && chown appuser:appuser /db
USER appuser
EXPOSE 3000
CMD ["pnpm", "start"]
