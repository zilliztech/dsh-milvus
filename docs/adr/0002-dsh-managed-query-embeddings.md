# Use DSH-managed query embeddings for dense search

> BM25 and hybrid retrieval in this record are superseded by
> [ADR 0003](./0003-schema-aware-bm25-hybrid-retrieval.md). The dense embedding
> decisions below remain active.

Natural-language dense search generates query embeddings on the DSH host with
a named OpenAI or Gemini embedding profile. A retrieval binding selects the
embedding profile for one Milvus deployment, collection, and FloatVector field.

The chat tool accepts query text but does not accept a provider, model, API key,
endpoint, or vector. Provider keys remain in DSH Credentials. The generated
vector is validated against the inspected field dimension, passed directly to
Milvus, and omitted from tool output.

Dense search fails closed when its binding, profile, key, supported vector
field, or exact dimension is unavailable. List, describe, get, and scalar query
operations remain usable without embedding configuration.

## Considered options

- Milvus-side embedding functions: not selected because existing collections
  may use client-generated vectors and the plugin must work without changing
  collection schemas.
- Application-owned embedding endpoints: not selected because they would make
  every user implement an additional API contract before search could work.
- Manual vector input in chat: not selected because float arrays are not a
  usable or safe conversational interface.

Custom provider endpoints and ingestion remain separate future capabilities
rather than implicit fallbacks.
