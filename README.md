# Milvus for DSH

Milvus for DSH is a read-only plugin that lets a DSH Web agent inspect data in
a Milvus deployment. Configure a local Milvus or Zilliz Cloud connection once,
then use the chat to discover collections, inspect schemas, and run bounded
scalar queries.

The plugin never creates, updates, or deletes Milvus data.

## What the plugin provides

| Tool | Purpose |
| --- | --- |
| `milvus_list_collections` | List collections visible to the selected deployment profile. |
| `milvus_describe_collection` | Inspect a collection's scalar and vector fields, indexes, load state, and row count. |
| `milvus_query` | Run a validated Milvus scalar filter and return selected scalar fields. |

Connection profiles are managed in DSH Web. Non-secret settings such as the
endpoint and database stay in plugin settings; tokens are stored through DSH
Credentials and are not returned to the chat.

## Requirements

- DSH Web `0.1.0-rc.7` or later
- Node.js 22.19 or later
- A Milvus HTTP(S) endpoint reachable from the machine running DSH Web
- A token when the target deployment requires authentication

## Install

Install the published package into the DSH Web profile:

```bash
dsh plugin --profile web add @zilliz/dsh-milvus
dsh web
```

If `dsh` is not installed as a command, use the npm launcher:

```bash
npx --yes @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add @zilliz/dsh-milvus
npx --yes @deepseek-ai/dsh@0.1.0-rc.7 web
```

Restart DSH Web after installing or updating the plugin, then refresh the
browser page.

## Configure a deployment

Open **Settings → Plugins → Milvus for DSH**.

### Local Milvus

1. Choose **Local**.
2. Confirm the endpoint. The default is `http://127.0.0.1:19530`.
3. Confirm the database. The default is `default`.
4. Select **Create profile**, then **Test connection**.
5. If another profile is active, select **Use for new sessions**.

The endpoint is resolved from the DSH Web host. If Milvus runs in another
container or on another machine, use an address reachable from that host rather
than its own loopback address.

### Zilliz Cloud

1. Choose **Zilliz Cloud**.
2. Enter the cluster's HTTPS endpoint and token.
3. Enter a database only when the deployment uses one. Leave it empty for a
   Zilliz Serverless cluster that does not require an explicit database.
4. Select **Create profile**, then **Test connection**.
5. If another profile is active, select **Use for new sessions**.

The token never enters plugin settings or chat history; it is sent to DSH
Credentials before the profile is saved. Do not put a token in a chat message,
repository file, README example, or test log.

## Run the first query

Start a new chat after selecting the deployment profile. A session binds to the
profile that is active when its first message arrives; changing the active
profile affects new sessions, not an existing chat.

Try this sequence:

1. “List the Milvus collections available to me.”
2. “Describe the `<collection-name>` collection.”
3. “In `<collection-name>`, return the first 10 rows where `id >= 0`, showing
   only `id` and `title`.”

Discovery and schema inspection should come before a query. If the collection,
field, or filter meaning is ambiguous, the agent should ask for clarification
instead of guessing.

## Query limits and safety

- `milvus_query` accepts Milvus scalar filter expressions.
- It returns 10 rows by default and accepts a maximum of 50 rows.
- Requested output fields must exist and must be scalar fields. Vector fields
  are never returned.
- Supported filter functions include `json_contains`, `array_contains`,
  `array_length`, and `text_match` when the collection schema supports them.
- The plugin provides no create, insert, upsert, delete, schema, index,
  database, user, role, or other administrative operation.
- Vector search, hybrid search, embedding generation, reranking, pagination,
  and data export are outside the current tool surface.

The selected Milvus credential remains the deployment's authorization
boundary. The plugin can discover and query only collections that credential
can access.

## Update or remove the plugin

Update the installed package and restart DSH Web:

```bash
dsh plugin --profile web update @zilliz/dsh-milvus
dsh web
```

Remove it from the Web profile with:

```bash
dsh plugin --profile web remove @zilliz/dsh-milvus
```

Removing the package does not delete Milvus data. Existing DSH settings and
credential records are managed by DSH and should be reviewed separately if the
connection will no longer be used.

## Troubleshooting

### The settings card is missing

Confirm that the package is installed in the `web` profile, restart DSH Web,
and refresh the browser. Use `dsh plugin --profile web why
@zilliz/dsh-milvus` to inspect the installed dependency.

### A tool reports that no profile is available

Create a profile, make it active for new sessions, and start a new chat. An
already-running chat does not switch deployments when profile settings change.

### The connection test fails

Check that the endpoint is reachable from the DSH Web host, that the token has
access to the target deployment, and that the database name is correct. For a
local container, verify how port `19530` is exposed to the host.

## Development

Install dependencies and run the default test suite:

```bash
npm ci
npm test
npm pack --dry-run
```

To load a source checkout into DSH Web, run this command from the repository
root and restart DSH Web:

```bash
dsh plugin --profile web add "$PWD"
```

Read-only integration probes run only when `MILVUS_TEST_ENDPOINT` is set:

```bash
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 npm run test:integration
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 npm run test:integration:connection
```

The mutation integration test creates and removes a disposable fixture. Run it
only against a non-production deployment after explicitly opting in:

```bash
MILVUS_TEST_ENDPOINT=http://127.0.0.1:19530 \
MILVUS_TEST_ALLOW_MUTATION=1 \
npm run test:integration:mutation
```

The host integration uses the official `@zilliz/milvus2-sdk-node` HTTP client.
No Cloud credential should be committed or written to test output.

## License

Apache-2.0. See [LICENSE](./LICENSE).
