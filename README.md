# Milvus for DSH

Milvus for DSH lets a DSH Web agent inspect and search a Milvus deployment
from chat. It supports Local Milvus and Zilliz Cloud, exact entity lookup,
scalar queries, BM25 full-text search, and dense+BM25 hybrid retrieval.
Natural-language dense search uses a DSH-managed OpenAI or Gemini embedding
provider; BM25 runs entirely from the collection's Milvus Function schema.

Every Milvus operation exposed by this plugin is read-only. The plugin does not
create collections, insert data, change indexes, or delete anything.

## Requirements

- DSH Web `0.1.0-rc.7` or later
- Node.js 22.19 or later
- A Milvus HTTP(S) endpoint reachable from the DSH Web host
- Optional: an [OpenAI API key](https://platform.openai.com/api-keys) or
  [Gemini API key](https://aistudio.google.com/app/apikey) for dense search

## Install

Install the package into the DSH Web profile:

```bash
dsh plugin --profile web add @zilliz/dsh-milvus
dsh web
```

If `dsh` is not installed globally:

```bash
npx --yes @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add @zilliz/dsh-milvus
npx --yes @deepseek-ai/dsh@0.1.0-rc.7 web
```

After installing or updating the plugin, restart DSH Web and refresh the
browser page.

## Set up the plugin

Open **Settings → Plugins → Milvus for DSH**. Connect Milvus first. Add the
embedding steps only when you need dense or hybrid retrieval.

### 1. Connect Milvus

For Local Milvus:

1. Select **Local Milvus Standalone**.
2. Enter an endpoint such as `http://127.0.0.1:19530`.
3. Enter the database name, normally `default`.
4. If authentication is enabled, select **Add optional Milvus authentication**
   and enter the token.
5. Create the profile and select **Test Milvus connection**.

For Zilliz Cloud:

1. Select **Zilliz Cloud**.
2. Enter the cluster's HTTPS endpoint and token.
3. Enter a database only when the deployment uses one.
4. Create the profile and select **Test Milvus connection**.

The endpoint is resolved from the machine running DSH Web. When Milvus runs in
another container or on another host, use an address reachable from the DSH
Web host—not a loopback address inside the Milvus container.

The active Milvus profile is bound when a new chat starts. Changing the active
profile affects new chats; it does not silently switch an existing chat to a
different deployment.

### 2. Add an embedding provider

This step is required only for natural-language dense and hybrid search. BM25
text search does not use an external embedding provider.

1. Create an embedding profile.
2. Choose **OpenAI** or **Google Gemini**.
3. Choose a model and enter its API key.
4. Create the profile and select **Test embedding provider**.

Supported models in the settings UI:

| Provider | Models |
| --- | --- |
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` |
| Gemini | `gemini-embedding-001`, `gemini-embedding-2` |

Milvus tokens and embedding API keys are saved through write-only DSH
Credentials. Their values are never stored in plugin settings, returned to the
browser after saving, or added to chat history.

### 3. Bind a collection vector field

Create a dense retrieval binding with:

- the Milvus profile;
- the exact collection name;
- the exact `FloatVector` field name; and
- the embedding profile used to create that field's stored vectors.

The model and vector space must match the embeddings already stored in Milvus.
Matching the vector dimension alone is not enough. In particular,
`gemini-embedding-001` and `gemini-embedding-2` use incompatible embedding
spaces, so they must not be interchanged for queries and documents.

The chat tool accepts natural-language query text; it never asks the user or
agent to supply a list of floats. DSH generates the query vector on the host,
checks its dimension against the collection schema, and sends it directly to
Milvus.

### 4. Set hybrid defaults (optional)

You do not need a collection policy when the collection has exactly one valid
BM25 route and RRF with `k=60` is a suitable default. In that common case, the
plugin discovers the route from the collection schema.

Create a collection policy in the settings card only when you need to:

- choose the exact BM25 text and `SparseFloatVector` fields in a collection
  that has multiple valid BM25 routes; or
- change the collection's default hybrid rerank to another RRF `k` or named
  dense/BM25 weights.

Select the Milvus profile, enter the exact collection, BM25 text field, and
sparse field names, then choose the rerank defaults. A rerank parameter supplied
in an individual chat request takes precedence over the saved collection
policy.

## Collection requirements for search

The plugin inspects each collection before searching it and reports whether
dense, BM25, and hybrid retrieval are ready.

Dense search requires a configured binding to a dimensional `FloatVector`
field. BM25 search requires all of these collection facts:

- one analyzer-enabled `VarChar` or `TEXT` input field;
- a Milvus BM25 Function mapping that text field to a `SparseFloatVector`
  output field; and
- a BM25 index on that sparse field.

When exactly one valid BM25 route exists, the plugin selects it automatically.
If a collection has several BM25 text fields, the user must identify the one
to search in the request or save an exact collection policy; the agent does not
guess. A plain `SparseFloatVector` field without a BM25 Function is not enough
because the plugin cannot infer which external sparse encoder created it.

Hybrid search is ready only when one dense binding and one BM25 route are both
ready. It never silently falls back to one route if the other route is missing
or fails.

## Use it from chat

Start a new chat after activating the desired Milvus profile. A useful first
sequence is:

1. “List my Milvus collections.”
2. “Describe the `documents` collection.”
3. “Get IDs 10 and 11 from `documents`, returning `id`, `title`, and `source`.”
4. “Query `documents` where `year >= 2025`, returning `id` and `title`.”
5. “Search `documents` for documents about vector indexing, returning `id`,
   `title`, and `source`.”
6. “Use BM25 to search `documents` for the exact phrase `HNSW efConstruction`,
   returning `id`, `title`, and `source`.”
7. “Run hybrid search for `how HNSW indexing works`, returning `id` and
   `title`.”
8. “Run hybrid search with dense weight 0.7 and BM25 weight 0.3.”

The agent should discover and describe a collection before using its fields.
When a collection, field, partition, or filter is ambiguous, it should ask
rather than guess.

## Available tools

| Tool | Purpose |
| --- | --- |
| `milvus_list_collections` | List collections visible to the chat's bound profile. |
| `milvus_describe_collection` | Show schema, indexes, load state, and dense/BM25/hybrid readiness or blockers. |
| `milvus_get` | Retrieve up to 50 entities by exact Int64 or VarChar primary key. |
| `milvus_query` | Run a bounded scalar query with optional filter and partitions. |
| `milvus_search` | Embed natural-language query text and run bounded dense search with optional filter and partitions. |
| `milvus_text_search` | Run bounded natural-language BM25 search through a schema-proven Milvus BM25 Function. |
| `milvus_hybrid_search` | Combine configured dense and BM25 routes, then fuse their rankings with RRF or Weighted rerank. |

Data-retrieval tools return only requested scalar fields. Stored dense/sparse
vectors and generated query vectors are never returned to chat. The default
result limit is 10 and the maximum is 50.

Dense-search results include the Milvus distance, vector field and metric, the
embedding provider/model/dimension, and safe timing metadata. They do not
include the API key, raw provider error body, or generated vector.

Hybrid rerank is part of `milvus_hybrid_search`, not a separate tool:

- no rerank parameter: RRF with `k=60`;
- explicit RRF: the user may provide another positive `k`;
- explicit Weighted: the user must provide both `denseWeight` and
  `bm25Weight`, each from 0 to 1 and not both zero.

Named weights prevent route-order mistakes. If the user asks only for
“Weighted” without values, the agent asks for both weights instead of guessing.
Search results state the effective rerank values and whether they came from the
request, a collection policy, or the plugin default.

## What happens without an embedding key

Collection listing, description, exact get, scalar query, and schema-compatible
BM25 search continue to work. Dense and hybrid search are blocked, with a
specific configuration result:

- no collection binding: `retrieval_binding_absent`;
- binding refers to a missing provider profile: `embedding_profile_absent`;
- API key is missing or unavailable: `embedding_credential_unavailable`.

The plugin does not fall back to the chat model, another provider, a guessed
vector, or a scalar query.

## Privacy and safety

- Dense-search query text is sent from the DSH host to the embedding provider
  selected in the binding.
- The generated vector remains in host memory and is sent only to Milvus.
- Milvus tokens and provider keys stay behind the DSH Credentials boundary.
- Output fields must exist in the inspected schema and must be scalar.
- Filters may reference only scalar fields discovered from that collection.
- Exact route fields prevent a saved BM25 plan from silently switching routes.
  A saved schema fingerprint, when present, additionally blocks the plan after
  any retrieval-schema change until it is reviewed.
- The plugin exposes no mutation, schema, index, database, user, role, or
  administrative operation.
- External sparse encoders, model/cross-encoder rerank, ingestion, custom
  embedding endpoints, and manual vector input are not currently supported.

## Troubleshooting

### The settings card is missing

Confirm that the package is installed in the `web` profile, restart DSH Web,
and refresh the page:

```bash
dsh plugin --profile web why @zilliz/dsh-milvus
```

### A tool says no Milvus profile is available

Create a Milvus profile, make it active for new chats, and start a new chat.
Existing chats retain their original session binding.

### The Milvus connection test fails

Check host-to-Milvus network reachability, endpoint protocol and port, database
name, and token permissions. Local Milvus normally exposes HTTP on port `19530`.

### The embedding provider test fails

Check that the API key is configured and allowed to use the selected model.
Also check provider rate limits and outbound network access from the DSH Web
host.

### Dense search reports a dimension mismatch

Describe the collection and compare the bound field's dimension with the model
used during ingestion. Correct the binding or re-ingest with the intended
model; do not choose a different model only because it can produce the same
dimension.

### BM25 or hybrid search is blocked

Describe the collection and read its retrieval capability section. Common
blockers are `bm25_route_absent`, `bm25_route_ambiguous`,
`sparse_encoder_binding_absent`, `retrieval_plan_stale`, and
`retrieval_binding_absent`. Fix or re-save the collection policy,
Function/index, or dense binding; hybrid search does not degrade to a single
route.

## Update or remove

Update the package, restart DSH Web, and refresh the browser:

```bash
dsh plugin --profile web update @zilliz/dsh-milvus
dsh web
```

Remove it from the Web profile with:

```bash
dsh plugin --profile web remove @zilliz/dsh-milvus
```

Removing the plugin does not change or delete Milvus data. Review stored DSH
settings and credential records separately if they are no longer needed.

## Development

Install dependencies and run the local checks:

```bash
npm ci
npm test
npm pack --dry-run
```

Load a source checkout into DSH Web from this repository and restart DSH Web:

```bash
dsh plugin --profile web add "$PWD"
```

Read-only integration probes run only when an endpoint is supplied:

```bash
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 npm run test:integration
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 npm run test:integration:connection
```

The mutation integration test creates, searches, and removes a disposable
fixture. Run it only against a non-production deployment after explicit opt-in:

```bash
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 \
MILVUS_TEST_ALLOW_MUTATION=1 \
npm run test:integration:mutation
```

To verify the complete provider-to-Milvus path, also provide a Gemini API key.
This test embeds a query, searches a disposable 128-dimensional collection
through `milvus_search`, and removes the fixture:

```bash
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 \
MILVUS_TEST_ALLOW_MUTATION=1 \
GEMINI_API_KEY=... \
npm run test:integration:retrieval
```

To verify BM25 and both hybrid rerank modes, use a non-production deployment.
The test first searches the existing `mfs_scale_2000` BM25 collection by
default, then creates and removes one disposable hybrid collection. Override
the existing collection name with `MILVUS_TEST_BM25_COLLECTION` when needed:

```bash
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 \
MILVUS_TEST_ALLOW_MUTATION=1 \
npm run test:integration:hybrid
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
