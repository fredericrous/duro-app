FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
RUN adduser -u 1001 -D appuser
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.npmrc ./.npmrc
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" >> .npmrc && \
    npm ci --omit=dev && \
    rm -f .npmrc
RUN mkdir -p /db && chown appuser:appuser /db
USER appuser
EXPOSE 3000
CMD ["npx", "react-router-serve", "./build/server/index.js"]
