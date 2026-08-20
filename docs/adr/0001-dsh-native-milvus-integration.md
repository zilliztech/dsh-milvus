# Use a dsh-native plugin with the official Node SDK

The first release runs only in dsh Web, so it registers native dsh tools and calls Milvus through the official Node SDK's `HttpClient`, rather than requiring an MCP server. MCP remains a later portability adapter for other hosts; it is not a dependency or user setup burden for the dsh product.

## Considered Options

- Native dsh tools plus SDK: selected because dsh owns the agent-tool and settings surfaces.
- A separate MCP server: deferred because it adds a process and configuration boundary without serving the first release's single-host goal.

