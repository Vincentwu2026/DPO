import { timingSafeEqual } from 'node:crypto'
import { isValidMeetingId, type WsHub } from '../hub/WsHub'

interface GraphNotification {
  subscriptionId?: string
  clientState?: string
  changeType?: string
  resource?: string
  resourceData?: { id?: string } & Record<string, unknown>
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Validates a Graph change-notification payload and relays each valid item to the
 * meeting room named by `resourceData.id`. Items with a bad clientState are dropped.
 * Returns the number of notifications dispatched.
 */
export function dispatchNotifications(
  hub: WsHub,
  body: unknown,
  expectedClientState: string
): number {
  if (!expectedClientState || typeof body !== 'object' || body === null) return 0
  const items = (body as { value?: unknown }).value
  if (!Array.isArray(items)) return 0

  let dispatched = 0
  for (const item of items as GraphNotification[]) {
    if (typeof item?.clientState !== 'string' || !safeEqual(item.clientState, expectedClientState))
      continue
    const resourceData = item.resourceData
    const meetingId = resourceData?.id
    if (!isValidMeetingId(meetingId)) continue
    hub.broadcast(meetingId, {
      type: 'GRAPH_NOTIFICATION',
      payload: { changeType: item.changeType, resource: item.resource, resourceData }
    })
    dispatched++
  }
  return dispatched
}
