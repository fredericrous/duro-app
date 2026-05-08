FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# Prod-only deps in their own stage so the runtime image is just
# node + node_modules + build artifacts — no package manager.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:24-alpine
RUN adduser -u 1001 -D appuser
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
RUN mkdir -p /db && chown appuser:appuser /db
USER appuser
EXPOSE 3000
# Direct node invocation against react-router-serve's bin entry —
# no package manager at runtime.
CMD ["node", "./node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
