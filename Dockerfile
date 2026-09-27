FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production VESPER_BIND=0.0.0.0 VESPER_PORT=4317 VESPER_DATA_DIR=/var/lib/vesper VESPER_VAULT_KEY_FILE=/var/lib/vesper-secrets/vault-keys.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /var/lib/vesper /var/lib/vesper-secrets && chown node:node /var/lib/vesper /var/lib/vesper-secrets && chmod 700 /var/lib/vesper /var/lib/vesper-secrets
USER node
VOLUME /var/lib/vesper
VOLUME /var/lib/vesper-secrets
EXPOSE 4317
CMD ["node", "dist/server/index.js"]
