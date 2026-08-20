import z from '@deepseek-ai/schemastery'
import { checkMilvusProfile } from './connection-check.mjs'

export const MILVUS_STATUS_NAMESPACE = 'dsh-milvus-status'

const CheckResultConfig = z.object({
  profileId: z.string().required(),
  checkedAt: z.number().required(),
  state: z.string().required(),
  message: z.string().required(),
})

export const ConnectionStatusConfig = z.object({
  request: z.object({
    profileId: z.string().required(),
    requestId: z.number().required(),
  }).default(null),
  checks: z.dict(CheckResultConfig).default({}),
})

const missingProfile = (profileId, checkedAt) => ({
  profileId,
  checkedAt,
  state: 'blocked',
  message: 'This profile is no longer configured.',
})

/**
 * Turn a browser's non-secret check request into a host-only Milvus probe.
 * The status namespace is deliberately separate from profile policy settings:
 * it carries a profile id, request nonce, and a safe result, never a token.
 */
export function attachConnectionStatusMonitor({
  statusScope,
  profileSource,
  resolveCredential,
  checkProfile = checkMilvusProfile,
  now = Date.now,
}) {
  let lastRequestKey = ''

  return statusScope.watch(async (status) => {
    const request = status.request
    if (!request) return
    const requestKey = `${request.profileId}:${request.requestId}`
    if (requestKey === lastRequestKey) return
    lastRequestKey = requestKey

    const profile = profileSource().profiles?.find((item) => item.id === request.profileId)
    const result = profile
      ? await checkProfile(profile, { resolveCredential, now })
      : missingProfile(request.profileId, now())

    // A later click wins. Do not let an older, slower probe overwrite it.
    const current = statusScope.get()
    if (current.request?.profileId !== request.profileId || current.request?.requestId !== request.requestId) return
    await statusScope.update({
      checks: { ...(current.checks ?? {}), [request.profileId]: result },
    })
  })
}
