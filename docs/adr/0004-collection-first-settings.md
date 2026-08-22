# ADR 0004: Use a collection-first settings experience

Status: Accepted
Date: 2026-08-22

## Context

The initial settings card exposed deployment profiles, embedding profiles,
dense bindings, and hybrid policies as four equally prominent forms. Those are
valid storage concepts but poor first-time navigation: users must understand
plugin internals before they can tell what an existing collection supports.

Milvus already exposes collection names and structural schema facts. The plugin
also has a constrained Host transport and a separate non-secret status bridge,
so the browser does not need direct database access.

## Decision

Organize settings around one connection and one inspected collection. Show the
collection's scalar, BM25, semantic, and hybrid capabilities first. Reveal
embedding setup only when semantic search is requested; place multiple-profile,
route-selection, rerank, and destructive controls in a collapsed Advanced
region.

Collection and field choices are Host-discovered values. Credentials remain
write-only dsh Credentials. A unique BM25 route and RRF(k=60) require no user
configuration.

## Consequences

- New users can stop after connection and collection selection.
- BM25-only use never depends on embedding configuration.
- The status namespace now carries normalized collection/schema facts, but no
  credentials, vectors, rows, or arbitrary SDK payloads.
- Storage may retain profiles/bindings/policies while the UI treats them as
  implementation details.
- The legacy four-section settings interaction is intentionally not preserved.
