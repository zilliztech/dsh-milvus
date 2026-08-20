# Milvus for DSH

`Milvus for DSH` is a read-only dsh Web plugin for Agent and RAG developers.
It connects a dsh session to one selected Milvus deployment and exposes three
bounded tools: collection discovery, collection inspection, and scalar query.

This development package is **not an official Zilliz release**. Its intended
future identity, subject to Zilliz authorization, is `@zilliz/dsh-milvus`.

## What it does

- Supports local Docker Milvus Standalone and Zilliz Cloud.
- Stores endpoint/database settings separately from credentials.
- Binds a new live dsh session to one profile; later profile changes do not
  silently change that session's Milvus target. Start a new chat after a Web
  restart before using Milvus tools.
- Exposes only `milvus_list_collections`, `milvus_describe_collection`, and
  `milvus_query`.
- Returns scalar fields only. `milvus_query` defaults to 10 rows and accepts at
  most 50.

It does not create, change, or delete Milvus data. It does not perform vector
or hybrid search, create embeddings, paginate, export data, or administer
Milvus.

## Install from this directory

Prerequisites: dsh Web **0.1.0-rc.7 or later**, Node.js 22.19 or later, and a
reachable Milvus HTTP(S) endpoint. rc.7 is required because it lets a public
plugin persist its registered Settings card through dsh Web. In the plugin
directory, install it into your dsh Web profile:

```bash
dsh plugin --profile web add /absolute/path/to/milvus-plugin
dsh web
```

If `dsh` is not on your shell PATH, do **not** clone dsh. Use its npm launcher
with Node.js 22.19 or later instead:

```bash
npx --yes @deepseek-ai/dsh@0.1.0-rc.7 plugin --profile web add /absolute/path/to/milvus-plugin
npx --yes @deepseek-ai/dsh@0.1.0-rc.7 web
```

Restart dsh Web after adding or updating the local package.

For development checks, use the project's Node version and run:

```bash
npm ci
npm test
```

## First query in dsh Web

1. Open **Plugins** in dsh Web and select **Milvus for DSH**.
2. Create a **Local** profile. Its Docker Standalone endpoint
   `http://127.0.0.1:19530` and database `default` are already filled in, so
   click **Create profile** unless your deployment differs. The plugin assigns
   its internal ID and display name automatically.
3. The first profile is selected for new sessions automatically. Run its
   connection check.
4. Start a **new chat**. This is important: the live session binds the profile
   it may use.
5. Ask: “List the Milvus collections available to me.”
6. Ask: “Describe the `<collection-name>` collection.”
7. Ask a bounded scalar question, for example: “In `<collection-name>`, return
   the first 10 rows where `id >= 0`, showing only `id` and `title`.”

The agent should discover a collection first, describe it to learn the exact
schema, then query it. If you have not specified an exact collection, field, or
filter meaning, it should ask instead of guessing.

## Zilliz Cloud smoke check

Choose **Zilliz Cloud** when creating a profile, enter its HTTPS endpoint and
token, and optionally a database when your deployment uses one, then click
**Create profile**. The plugin assigns its
internal ID, display name, and credential reference automatically. The token
is written to dsh Credentials before the profile is saved; it never enters
plugin settings.

For a Zilliz Serverless cluster, leave **Database** empty. The plugin keeps it
empty for the Node SDK too, so the SDK does not silently substitute `default`.

Never put a Cloud token in a chat message, `package.json`, README example,
shell history, repository file, or test log. Confirm the connection, begin a
new chat, then repeat list → describe → one scalar query. Record only pass/fail,
endpoint region, database name if non-sensitive, and plugin/SDK versions.

## Release checklist

- Run `npm test` and the explicitly enabled real-Milvus integration suite.
- Run the local dsh Web install path above.
- Complete and record the Cloud smoke check without recording credentials.
- Obtain authorization before changing the name to `@zilliz/dsh-milvus`, making
  the package public, or presenting it as an official Zilliz release.
- Publish only from the authorized npm scope and GitHub repository.

## License

Apache-2.0. See [LICENSE](./LICENSE).
