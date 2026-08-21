# Add schema-aware BM25 and dense+BM25 hybrid retrieval

DSH exposes BM25 as natural-language text search only when collection schema
facts prove a Milvus BM25 Function route from an analyzer-enabled text field to
an indexed SparseFloatVector field. It does not accept manual sparse vectors or
infer an external sparse encoder.

Hybrid search combines exactly one configured DSH-managed dense route and one
schema-proven BM25 route. Rerank is an optional Hybrid Search parameter rather
than a standalone tool. An explicit valid parameter overrides a saved
collection policy; otherwise the plugin uses RRF with `k=60`. The first release
also supports named dense/BM25 Weighted values.

The DSH Web settings card exposes the optional collection policy. Most
collections need no saved policy: a unique valid BM25 route is discovered from
schema facts, and the plugin default applies. A policy is intended for an exact
route choice or a collection-specific rerank default.

Schema facts may establish structural capability but not semantic intent. A
unique valid BM25 route can be selected automatically; multiple routes require
an explicit field or saved policy, and a changed configured schema blocks
rather than silently switching fields.

## Considered options

- Generic sparse vector input: not selected because sparse encoder ownership
  would reintroduce implementation vectors into chat and cannot be inferred
  from field type.
- Standalone rerank tool: not selected because RRF/Weighted fusion operates on
  candidates within one hybrid request and has no useful independent result.
- Automatic hybrid fallback: not selected because returning one route after
  another fails would misrepresent the requested retrieval method.
- Model/cross-encoder rerank: deferred because it introduces another provider,
  credential, latency, and text-field compatibility contract.
