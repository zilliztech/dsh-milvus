import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { attachCollectionStatusMonitor, attachConnectionStatusMonitor, attachEmbeddingStatusMonitor, ConnectionStatusConfig, MILVUS_STATUS_NAMESPACE } from './connection-status.mjs'
import { createEmbeddingProvider } from './embedding-provider.mjs'
import { createMilvusTransport } from './milvus-transport.mjs'
import { registerMilvusTools } from './milvus-tools.mjs'
import { ProfileSettingsConfig, validateProfileSettings } from './profile-settings.mjs'
import { bindOrResolveSessionProfile } from './session-binding.mjs'

/** Host half of the Milvus for DSH bundle. */
export const name = 'dsh-milvus'

// This namespace is the stable join key between the host-side settings
// registration and the dsh Web settings card.
export const MILVUS_SETTINGS_NAMESPACE = settingsNamespace('dsh-milvus')
export { MILVUS_STATUS_NAMESPACE }

// Settings contain only deployment facts. Tokens and passwords belong in dsh
// Credentials and are rejected before the settings provider persists a change.
export const Config = ProfileSettingsConfig

export function apply(ctx, config) {
  let profileSource = () => config ?? {}
  installSettingsSection(ctx, MILVUS_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (current) => { profileSource = current },
    onChange: () => {},
    validate: validateProfileSettings,
  })

  ctx.inject(['settings'], (settingsCtx) => {
    const statusScope = settingsCtx.settings.register(MILVUS_STATUS_NAMESPACE, ConnectionStatusConfig, { base: {} })
    settingsCtx.effect(() => {
      const resolveCredential = (ref) => settingsCtx.get('credentials')?.resolve(credentialRef(ref))
      const disposeMilvus = attachConnectionStatusMonitor({ statusScope, profileSource, resolveCredential })
      const disposeEmbedding = attachEmbeddingStatusMonitor({ statusScope, profileSource, resolveCredential })
      const disposeCollections = attachCollectionStatusMonitor({
        statusScope,
        profileSource,
        createTransport: (profile) => createMilvusTransport({ profile, resolveCredential }),
      })
      return () => {
        disposeMilvus?.()
        disposeEmbedding?.()
        disposeCollections?.()
      }
    })
  })

  ctx.inject(['credentials', 'tools', 'systemPrompt'], (sctx) => {
    const boundProfileFor = (exec) => {
      if (!exec.agent?.session) return undefined
      return bindOrResolveSessionProfile(exec.agent.session, profileSource())
    }
    sctx.on('agent/session-start', ({ agent }) => {
      bindOrResolveSessionProfile(agent.session, profileSource())
    })
    const embeddingProvider = createEmbeddingProvider({
      resolveCredential: (ref) => sctx.credentials.resolve(credentialRef(ref)),
    })
    registerMilvusTools(sctx, {
      bindingFor: boundProfileFor,
      settingsFor: profileSource,
      embeddingProvider,
      createTransport: (profile) => createMilvusTransport({
        profile,
        resolveCredential: (ref) => sctx.credentials.resolve(credentialRef(ref)),
      }),
    })
    sctx.systemPrompt.section({
      name: 'tool:milvus',
      order: 110,
      text: 'Use Milvus tools only for the deployment bound to this session. Discover collections first, then describe a collection before getting, querying, or searching it. Use milvus_get for exact primary keys, milvus_query for scalar filters, milvus_search for configured dense retrieval, milvus_text_search for schema-proven BM25 full-text retrieval, and milvus_hybrid_search only when both routes are ready. Hybrid rerank defaults to RRF(k=60); pass a rerank parameter only when the user explicitly requests another RRF k or supplies both dense and BM25 weights. Do not guess a collection, field, vector field, BM25 route, partition, filter meaning, or missing weight: ask the user when discovery and schema inspection do not resolve ambiguity. Never silently fall back from hybrid to one route. All operations are read-only and never return vector fields or query vectors.',
    })
  })
}
