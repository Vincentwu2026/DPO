/** Only an https dashboard URL (http for loopback development) is ever opened or shown. */
export function parseDashboardUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.toString()
  } catch {
    // fall through
  }
  return null
}
