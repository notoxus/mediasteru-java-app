# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS electron-builder
WORKDIR /src/electron
COPY electron/package.json electron/package-lock.json ./
RUN npm ci --ignore-scripts
COPY electron/tsconfig.json ./
COPY electron/scripts ./scripts
COPY electron/src ./src
COPY electron/static ./static
COPY assets/logo.png /src/assets/logo.png
RUN npm run build

FROM node:22-bookworm-slim AS tools-builder
WORKDIR /src
COPY tools-manifest.json ./
COPY scripts/sync-tools.mjs ./scripts/sync-tools.mjs
RUN node scripts/sync-tools.mjs --tools-dir=/out/tools

FROM rust:1.88-bookworm AS cli-builder
WORKDIR /src/cli
COPY cli/Cargo.toml cli/Cargo.lock ./
COPY cli/src ./src
RUN cargo build --release --locked

FROM node:22-trixie-slim AS runtime
LABEL org.opencontainers.image.title="MediaSteru"
LABEL org.opencontainers.image.description="Headless MediaSteru core with its Rust CLI/TUI"
LABEL org.opencontainers.image.source="https://github.com/notoxus/mediasteru"

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    MEDIASTERU_PROJECT_ROOT=/app \
    MEDIASTERU_DATA_DIR=/data \
    MEDIASTERU_DOWNLOAD_DIR=/downloads \
    MEDIASTERU_PORT=8765

WORKDIR /app
RUN mkdir -p /app/tools /data /downloads && chown -R node:node /app /data /downloads
COPY --from=electron-builder --chown=node:node /src/electron/dist ./dist
COPY --from=tools-builder --chown=node:node /out/tools ./tools
COPY --from=cli-builder /src/cli/target/release/mediasteru /usr/local/libexec/mediasteru
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/mediasteru-entrypoint
COPY --chmod=755 docker/cli-entrypoint.sh /usr/local/bin/mediasteru

VOLUME ["/data", "/downloads"]
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8765/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/mediasteru-entrypoint"]
CMD ["node", "dist/daemon.js"]
