FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json .npmrc ./
RUN npm install
COPY . .
RUN npm run build

FROM node:24-alpine
RUN adduser -u 1001 -D appuser
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.npmrc ./.npmrc
RUN npm install --omit=dev
RUN mkdir -p /db && chown appuser:appuser /db
ENV EXPO_NO_TELEMETRY=1
USER appuser
EXPOSE 3000
CMD ["npm", "start"]
