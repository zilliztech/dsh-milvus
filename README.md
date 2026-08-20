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
  silently change that session's Milvus target. A session's binding is fixed
  when its first message arrives, so changing or removing the active profile
  only affects sessions started afterward — start a new chat after changing
  profiles before using Milvus tools.
- Exposes only `milvus_list_collections`, `milvus_describe_collection`, and
  `milvus_query`.
- Returns scalar fields only. `milvus_query` defaults to 10 rows and accepts at
  most 50, and its filter accepts Milvus scalar expressions including
  functions such as `json_contains`, `array_contains`, `array_length`, and
  `text_match` while still rejecting unknown field references.

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

### Hot reload without restarting dsh Web

`dsh plugin add` registers the plugin in the profile's bundle layer, which is
fixed at startup. If you only need the plugin for the current dsh Web session
and prefer not to restart, add its row to the profile's live patch layer
instead — dsh Web watches `cordis.patch.yml` and hot-mounts inserted rows:

```bash
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: dsh-milvus
      name: dsh-milvus
```

The host tools and Settings card become available immediately; refresh the
page to load the client card. The patch row persists across restarts, so
prefer it over the bundle layer when you want the plugin to survive reboots
without an extra `dsh plugin add`.

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

### Publishing to npm (`@zilliz/dsh-milvus`)

The package is intentionally unpublished and named `dsh-milvus` until Zilliz
authorizes the public identity `@zilliz/dsh-milvus`. Publishing requires:

1. **Zilliz authorization** to use the `@zilliz` npm scope and the
   `zilliztech/dsh-milvus` repository for an official release. The npm scope
   itself is Zilliz-owned (it already hosts `@zilliz/milvus2-sdk-node`), so the
   blocker is organizational approval, not name availability.
2. **npm publish credentials** for the `@zilliz` scope. Verify with
   `npm whoami` and `npm access ls packages @zilliz`; the account must be an
   owner of `@zilliz/dsh-milvus` (or the scope) with `publish` permission.
3. **Metadata edits** that go with the rename, all in one commit:
   - `package.json`: `"name": "@zilliz/dsh-milvus"`, remove `"private": true`,
     set a real version, and add the `repository`/`homepage` fields.
   - `cordis.patch.yml`: change `name: dsh-milvus` to `name: @zilliz/dsh-milvus`
     (the loader resolves plugin rows by package name, so the two must match).
   - `client.js`: keep the `dsh-milvus` bundle id (it is the plugin's stable
     identity inside dsh Web) — only the npm package name changes.
4. Publish with `npm publish --access public` from the authorized scope.

The GitHub PR path does not need these steps: upstream review can merge the
code while the package stays private and unpublished.

## License

Apache-2.0. See [LICENSE](./LICENSE).
