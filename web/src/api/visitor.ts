let visitorId: string | undefined

/** A random browser identifier, never a fingerprint or manuscript-derived value. */
export function getVisitorId(): string | undefined {
  if (visitorId) return visitorId
  try {
    const stored = localStorage.getItem('storytool-visitor')
    visitorId = stored && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stored)
      ? stored : crypto.randomUUID()
    localStorage.setItem('storytool-visitor', visitorId)
    return visitorId
  } catch {
    // Storage restrictions must not interrupt writing or sign-in.
    return undefined
  }
}
