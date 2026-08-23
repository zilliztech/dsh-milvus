# ADR 0005: Use a curated API-key embedding provider catalog

Status: Accepted
Date: 2026-08-23

## Context

DSH-managed query embeddings originally supported OpenAI and Gemini. Existing
Milvus collections are also commonly populated with Cohere, Voyage, Mistral,
Jina, and Together models. Requiring those users to write a separate query
embedding application defeats the managed Host boundary.

Provider authentication and endpoint requirements are not uniform. Some cloud
services require a deployment endpoint, region, project, OAuth flow, or signed
cloud credential rather than one API key.

## Decision

Support seven curated API-key providers through fixed official production
endpoints: OpenAI, Google Gemini, Cohere, Voyage AI, Mistral AI, Jina AI, and
Together AI. Persist only an exact provider/model pair and a DSH Credential
reference. Do not expose an arbitrary base URL.

Maintain an explicit model and output-dimension catalog. It includes recommended
current models and a small number of still-served compatibility models that are
common in existing vector collections; it excludes experimental, deprecated,
and dedicated-endpoint-only ids. The Host rejects an unsupported provider,
model, or target dimension before credential resolution or network I/O.
Provider adapters add retrieval-query intent where the official API defines it,
validate the returned float vector, and publish only non-secret provenance.

The reviewed production contracts are:

| Provider | Endpoint | Primary documentation |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/embeddings` | [Create embeddings](https://platform.openai.com/docs/api-reference/embeddings/create) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent` | [Embeddings](https://ai.google.dev/gemini-api/docs/embeddings) |
| Cohere | `https://api.cohere.com/v2/embed` | [Embed](https://docs.cohere.com/reference/embed) |
| Voyage AI | `https://api.voyageai.com/v1/embeddings` | [Embeddings API](https://docs.voyageai.com/reference/embeddings-api) |
| Mistral AI | `https://api.mistral.ai/v1/embeddings` | [Embeddings API](https://docs.mistral.ai/api/endpoint/embeddings) |
| Jina AI | `https://api.jina.ai/v1/embeddings` | [Embeddings](https://jina.ai/embeddings/) |
| Together AI | `https://api.together.ai/v1/embeddings` | [Embeddings](https://docs.together.ai/docs/inference/embeddings/embeddings) |

These links are contract references, not discovery endpoints. Updating a model,
dimension rule, task mode, endpoint, or API version requires reviewing the
corresponding primary documentation and adapter contract test together.

## Consequences

- Common hosted query embeddings remain a settings operation instead of user
  application code.
- The Web form can disable model/field combinations that cannot match by
  dimension, while still warning that dimension alone does not prove vector
  compatibility.
- New model ids require a reviewed catalog update rather than passing arbitrary
  strings to a provider.
- Azure OpenAI, Amazon Bedrock, Vertex AI, custom endpoints, and other
  multi-field authentication contracts remain separate future work.
