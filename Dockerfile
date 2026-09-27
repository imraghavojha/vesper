FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24.21.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production VESPER_BIND=0.0.0.0 VESPER_PORT=4317 VESPER_DATA_DIR=/var/lib/vesper
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /var/lib/vesper && chown node:node /var/lib/vesper
USER node
VOLUME /var/lib/vesper
EXPOSE 4317
CMD ["node", "dist/server/index.js"]
