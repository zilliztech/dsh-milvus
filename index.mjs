import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { attachConnectionStatusMonitor, ConnectionStatusConfig, MILVUS_STATUS_NAMESPACE } from './connection-status.mjs'
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
    settingsCtx.effect(() => attachConnectionStatusMonitor({
      statusScope,
      profileSource,
      resolveCredential: (ref) => settingsCtx.get('credentials')?.resolve(credentialRef(ref)),
    }))
  })

  ctx.inject(['credentials', 'tools', 'systemPrompt'], (sctx) => {
    const boundProfileFor = (exec) => {
      if (!exec.agent?.session) return undefined
      return bindOrResolveSessionProfile(exec.agent.session, profileSource())
    }
    sctx.on('agent/session-start', ({ agent }) => {
      bindOrResolveSessionProfile(agent.session, profileSource())
    })
    registerMilvusTools(sctx, {
      bindingFor: boundProfileFor,
      createTransport: (profile) => createMilvusTransport({
        profile,
        resolveCredential: (ref) => sctx.credentials.resolve(credentialRef(ref)),
      }),
    })
    sctx.systemPrompt.section({
      name: 'tool:milvus',
      order: 110,
      text: 'Use Milvus tools only for the deployment bound to this session. Discover collections first, then describe a collection before querying it. Do not guess a collection name, a field, or a filter meaning: when discovery and schema inspection do not resolve the ambiguity, ask the user. Query tools are read-only and never return vector fields.',
    })
  })
}
