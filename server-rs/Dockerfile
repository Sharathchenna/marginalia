# Marginalia data + sync server. Self-contained (the db/metadata/embeddings
# modules live in server-rs/core/src now), so the build context just needs the
# server-rs/ tree:   docker build -f server-rs/Dockerfile -t marginalia-data .
FROM rust:1-bookworm AS build
WORKDIR /app
COPY server-rs ./server-rs
RUN cd server-rs && cargo build --release -p marginalia-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/server-rs/target/release/marginalia-server /usr/local/bin/marginalia-server

ENV PORT=8800 \
    MARG_DB=/data/library.db \
    MARG_PDF_DIR=/data/pdfs
VOLUME ["/data"]
EXPOSE 8800

# Provide at runtime: MARG_TOKEN (recommended). The Voyage embedding key is set
# per-library via PUT /v1/settings, not here.
CMD ["marginalia-server"]
