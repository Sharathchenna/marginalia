# Marginalia data + sync server. BUILD CONTEXT MUST BE THE REPO ROOT, because
# the `core` crate reuses ../../../src-tauri/src/{db,metadata,embeddings}.rs via
# #[path]:   docker build -f server-rs/Dockerfile -t marginalia-data .
FROM rust:1-bookworm AS build
WORKDIR /app
# The shared modules the core crate #[path]-includes.
COPY src-tauri/src ./src-tauri/src
# The server workspace.
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
