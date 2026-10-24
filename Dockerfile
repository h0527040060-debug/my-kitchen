# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true; else npm ci --strict-ssl=true; fi
COPY . .
RUN npm run build
RUN npm prune --omit=dev
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libheif-examples ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data/media /app/data/uploads /app/backups && chown -R node:node /app/data /app/backups
USER node
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "server/index.ts"]
