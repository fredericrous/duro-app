FROM rust:1-alpine AS wasm-builder
RUN apk add --no-cache musl-dev curl
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
WORKDIR /wasm
COPY packages/opaque-client/Cargo.toml packages/opaque-client/src ./
COPY packages/opaque-client/src ./src
RUN wasm-pack build --target nodejs --out-dir pkg --release

FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY --from=wasm-builder /wasm/pkg ./packages/opaque-client/pkg
COPY package.json package-lock.json .npmrc ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine
RUN adduser -u 1001 -D appuser
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.npmrc ./.npmrc
COPY --from=wasm-builder /wasm/pkg ./packages/opaque-client/pkg
RUN npm install --omit=dev
RUN mkdir -p /db && chown appuser:appuser /db
USER appuser
EXPOSE 3000
CMD ["npm", "start"]
