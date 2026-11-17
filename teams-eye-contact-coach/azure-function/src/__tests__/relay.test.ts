import { describe, expect, it, vi } from 'vitest'
import { WsHub, type HubClient } from '../hub/WsHub'
import { dispatchNotifications } from '../notifications/dispatch'

type Handler = (data?: unknown) => void

class FakeClient {
  readyState = 1
  sent: { type: string; payload?: unknown }[] = []
  private handlers = new Map<string, Handler>()
  send = vi.fn((data: string) => {
    this.sent.push(JSON.parse(data))
  })
  close = vi.fn()
  on(event: string, handler: Handler): this {
    this.handlers.set(event, handler)
    return this
  }
  receive(msg: unknown): void {
    this.handlers.get('message')?.(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  disconnect(): void {
    this.handlers.get('close')?.()
  }
  asClient(): HubClient {
    return this as unknown as HubClient
  }
}

function joined(hub: WsHub, meetingId: string): FakeClient {
  const c = new FakeClient()
  hub.handleConnection(c.asClient())
  c.receive({ type: 'JOIN', meetingId })
  return c
}

describe('WsHub', () => {
  it('tracks clients by meeting and acknowledges JOIN', () => {
    const hub = new WsHub()
    const a = joined(hub, 'm1')
    joined(hub, 'm1')
    joined(hub, 'm2')

    expect(hub.clientCount('m1')).toBe(2)
    expect(hub.clientCount('m2')).toBe(1)
    expect(a.sent[0]).toEqual({ type: 'JOINED', payload: { meetingId: 'm1' } })
  })

  it('broadcast sends { type, payload } only to clients in that meeting', () => {
    const hub = new WsHub()
    const a = joined(hub, 'm1')
    const other = joined(hub, 'm2')

    expect(hub.broadcast('m1', { type: 'X', payload: { n: 1 } })).toBe(1)

    expect(a.sent.at(-1)).toEqual({ type: 'X', payload: { n: 1 } })
    expect(other.sent.some((m) => m.type === 'X')).toBe(false)
  })

  it.each(['START_TRACKING', 'STOP_TRACKING'])(
    'relays %s from a member to all other clients in the same meeting only',
    (type) => {
      const hub = new WsHub()
      const host = joined(hub, 'm1')
      const peer = joined(hub, 'm1')
      const outsider = joined(hub, 'm2')

      host.receive({ type, meetingId: 'm1' })

      expect(peer.sent.at(-1)).toEqual({ type, payload: { meetingId: 'm1' } })
      expect(host.sent.some((m) => m.type === type)).toBe(false)
      expect(outsider.sent.some((m) => m.type === type)).toBe(false)
    }
  )

  it('rejects host commands from clients that have not joined that meeting', () => {
    const hub = new WsHub()
    const peer = joined(hub, 'm1')
    const stranger = new FakeClient()
    hub.handleConnection(stranger.asClient())

    stranger.receive({ type: 'START_TRACKING', meetingId: 'm1' })

    expect(peer.sent.some((m) => m.type === 'START_TRACKING')).toBe(false)
  })

  it('ignores malformed JSON, unknown types and invalid meeting ids', () => {
    const hub = new WsHub()
    const peer = joined(hub, 'm1')
    const c = joined(hub, 'm1')

    c.receive('not json')
    c.receive({ type: 'DROP_TABLES', meetingId: 'm1' })
    c.receive({ type: 'START_TRACKING', meetingId: '../../etc' })

    expect(peer.sent).toHaveLength(1) // only its own JOINED ack
  })

  it('removes clients on disconnect and skips non-open sockets', () => {
    const hub = new WsHub()
    const a = joined(hub, 'm1')
    const b = joined(hub, 'm1')

    b.readyState = 3
    expect(hub.broadcast('m1', { type: 'X' })).toBe(1)

    a.disconnect()
    b.disconnect()
    expect(hub.clientCount('m1')).toBe(0)
  })
})

describe('dispatchNotifications', () => {
  const STATE = 'shared-secret'
  const body = (...items: object[]): object => ({ value: items })

  it('dispatches validated notifications to the meeting room named by resourceData.id', () => {
    const hub = new WsHub()
    const client = joined(hub, 'meeting-1')

    const n = dispatchNotifications(
      hub,
      body({
        clientState: STATE,
        changeType: 'created',
        resource: 'communications/callRecords/abc',
        resourceData: { id: 'meeting-1' }
      }),
      STATE
    )

    expect(n).toBe(1)
    expect(client.sent.at(-1)).toEqual({
      type: 'GRAPH_NOTIFICATION',
      payload: {
        changeType: 'created',
        resource: 'communications/callRecords/abc',
        resourceData: { id: 'meeting-1' }
      }
    })
  })

  it('drops notifications with a missing or wrong clientState', () => {
    const hub = new WsHub()
    const client = joined(hub, 'meeting-1')
    const items = [
      { resourceData: { id: 'meeting-1' } },
      { clientState: 'wrong-secret', resourceData: { id: 'meeting-1' } },
      { clientState: 'x', resourceData: { id: 'meeting-1' } }
    ]

    expect(dispatchNotifications(hub, body(...items), STATE)).toBe(0)
    expect(client.sent).toHaveLength(1) // JOINED only
  })

  it('drops items with an invalid meeting id and tolerates malformed bodies', () => {
    const hub = new WsHub()
    expect(
      dispatchNotifications(hub, body({ clientState: STATE, resourceData: { id: 42 } }), STATE)
    ).toBe(0)
    expect(dispatchNotifications(hub, null, STATE)).toBe(0)
    expect(dispatchNotifications(hub, { value: 'nope' }, STATE)).toBe(0)
    expect(dispatchNotifications(hub, body({ clientState: '' }), '')).toBe(0) // unconfigured secret
  })

  it('processes the valid items in a mixed batch', () => {
    const hub = new WsHub()
    joined(hub, 'm1')
    const n = dispatchNotifications(
      hub,
      body(
        { clientState: STATE, resourceData: { id: 'm1' } },
        { clientState: 'bad', resourceData: { id: 'm1' } }
      ),
      STATE
    )
    expect(n).toBe(1)
  })
})
