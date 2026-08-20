const profileKeys = ['id', 'name', 'kind', 'endpoint', 'database', 'credentialRef']
const liveBindings = new WeakMap()

function snapshotProfile(profile) {
  return Object.fromEntries(profileKeys
    .filter((key) => profile[key] !== undefined)
    .map((key) => [key, profile[key]]))
}

function sameProfile(left, right) {
  return profileKeys.every((key) => left[key] === right[key])
}

function hasUserMessage(session) {
  return session.events.some((event) => event.type === 'user/message')
}

/**
 * Take the active profile snapshot exactly once for a live, new session.
 * dsh has no plugin event-registration surface, so a plugin-owned durable
 * session event would make historical logs unreadable after restart. A loaded
 * session without a live binding therefore fails closed rather than adopting a
 * newly selected target. dsh writes its own bootstrap events before
 * agent/session-start, so an empty event list is not a reliable new-session
 * signal; the first user message is the durable boundary instead.
 */
export function bindOrResolveSessionProfile(session, settings) {
  const bound = liveBindings.get(session)
  if (bound) {
    const configured = settings?.profiles?.find((profile) => profile.id === bound.id)
    return configured && sameProfile(bound, configured) ? bound : undefined
  }

  if (hasUserMessage(session)) return undefined

  const selected = settings?.profiles?.find((profile) => profile.id === settings.activeProfileId)
  if (!selected) return undefined
  const profile = snapshotProfile(selected)
  liveBindings.set(session, profile)
  return profile
}
