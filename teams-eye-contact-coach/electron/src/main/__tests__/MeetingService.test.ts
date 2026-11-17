import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// MeetingService imports `ws` only as a default for the real socket; tests inject their own socket.
vi.mock('ws', () => ({ default: class {} }))

import {
  isAllowedSocketUrl,
  MeetingService,
  PRESENCE_POLL_MS,
  SPEAKER_POLL_MS,
  SUBSCRIPTION_RENEW_MS,
  type MeetingSocket
} from '../meeting/MeetingService'

const USER_ID = 'user-1'
const BASE = 'https://func.example.net'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

class FakeSocket implements MeetingSocket {
  readyState = 1
  sent: string[] = []
  handlers: Record<string, (data?: unknown) => void> = {}
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.readyState = 3
  }
  on(event: string, listener: (data?: unknown) => void): this {
    this.handlers[event] = listener
    return this
  }
}

interface Harness {
  service: MeetingService
  setPresence: (activity: string) => void
  setSpeaker: (isActive: boolean) => void
  socket: FakeSocket
  fetchFn: ReturnType<typeof vi.fn>
  events: string[]
}

function setup(): Harness {
  let activity = 'Available'
  let speaking = false
  const socket = new FakeSocket()

  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/presence')) return json({ activity })
    if (url.endsWith('/communications/calls')) {
      return json({
        value: [{ id: 'call-1', state: 'established', chatInfo: { threadId: 'thread-1' } }]
      })
    }
    if (url.endsWith('/participants')) {
      return json({
        value: [
          { isActiveSpeaker: speaking, info: { identity: { user: { id: USER_ID } } } },
          { isActiveSpeaker: !speaking, info: { identity: { user: { id: 'someone-else' } } } }
        ]
      })
    }
    if (url.endsWith('/api/connect-info')) return json({ url: 'ws://127.0.0.1:8081' })
    if (url.endsWith('/subscriptions') && method === 'POST') return json({ id: 'sub-1' })
    if (url.includes('/subscriptions/') && method === 'PATCH') return json({})
    return json({}, 404)
  })

  const service = new MeetingService({
    auth: {
      getAccessToken: vi.fn().mockResolvedValue('graph-token'),
      getUserId: vi.fn().mockResolvedValue(USER_ID)
    },
    functionBaseUrl: BASE,
    clientState: 'secret-state',
    fetchFn: fetchFn as unknown as typeof fetch,
    createSocket: () => socket
  })

  const events: string[] = []
  for (const e of ['MEETING_STARTED', 'MEETING_ENDED', 'SPEAKER_ACTIVE', 'SPEAKER_INACTIVE']) {
    service.on(e, () => events.push(e))
  }

  return {
    service,
    socket,
    fetchFn,
    events,
    setPresence: (a) => (activity = a),
    setSpeaker: (s) => (speaking = s)
  }
}

describe('MeetingService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('presence polling state machine', () => {
    it('emits MEETING_STARTED once when presence changes to InACall', async () => {
      const h = setup()
      h.setPresence('InACall')

      await h.service.pollPresence()
      await h.service.pollPresence()

      expect(h.events).toEqual(['MEETING_STARTED'])
      h.service.stop()
    })

    it('emits MEETING_ENDED when presence changes away from InACall', async () => {
      const h = setup()
      h.setPresence('InACall')
      await h.service.pollPresence()

      h.setPresence('Available')
      await h.service.pollPresence()

      expect(h.events).toEqual(['MEETING_STARTED', 'MEETING_ENDED'])
      h.service.stop()
    })

    it('emits nothing while presence stays Available', async () => {
      const h = setup()
      await h.service.pollPresence()
      expect(h.events).toEqual([])
    })

    it('polls presence on a 15 s interval after start()', async () => {
      const h = setup()
      await h.service.start()
      const presenceCalls = () =>
        h.fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/presence')).length
      const before = presenceCalls()

      h.setPresence('InACall')
      await vi.advanceTimersByTimeAsync(PRESENCE_POLL_MS)

      expect(presenceCalls()).toBe(before + 1)
      expect(h.events).toContain('MEETING_STARTED')
      h.service.stop()
    })

    it('sends the bearer token over HTTPS only to Graph', async () => {
      const h = setup()
      await h.service.pollPresence()
      const [url, init] = h.fetchFn.mock.calls[0] as [string, RequestInit]
      expect(url.startsWith('https://graph.microsoft.com/')).toBe(true)
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer graph-token')
    })
  })

  describe('active-speaker polling', () => {
    it('emits SPEAKER_ACTIVE when the signed-in user becomes active speaker, then SPEAKER_INACTIVE', async () => {
      const h = setup()
      h.setPresence('InACall')
      await h.service.pollPresence() // attaches to the call, starts 5 s speaker timer

      h.setSpeaker(true)
      await vi.advanceTimersByTimeAsync(SPEAKER_POLL_MS)
      expect(h.events).toEqual(['MEETING_STARTED', 'SPEAKER_ACTIVE'])

      await vi.advanceTimersByTimeAsync(SPEAKER_POLL_MS) // unchanged → no duplicate
      expect(h.events).toEqual(['MEETING_STARTED', 'SPEAKER_ACTIVE'])

      h.setSpeaker(false)
      await vi.advanceTimersByTimeAsync(SPEAKER_POLL_MS)
      expect(h.events).toEqual(['MEETING_STARTED', 'SPEAKER_ACTIVE', 'SPEAKER_INACTIVE'])
      h.service.stop()
    })

    it('ignores other participants being the active speaker', async () => {
      const h = setup()
      h.setPresence('InACall')
      await h.service.pollPresence()

      h.setSpeaker(false) // only "someone-else" is speaking
      await vi.advanceTimersByTimeAsync(SPEAKER_POLL_MS)

      expect(h.events).toEqual(['MEETING_STARTED'])
      h.service.stop()
    })

    it('emits SPEAKER_INACTIVE before MEETING_ENDED when the call ends mid-speech', async () => {
      const h = setup()
      h.setPresence('InACall')
      await h.service.pollPresence()
      h.setSpeaker(true)
      await vi.advanceTimersByTimeAsync(SPEAKER_POLL_MS)

      h.setPresence('Available')
      await h.service.pollPresence()

      expect(h.events).toEqual([
        'MEETING_STARTED',
        'SPEAKER_ACTIVE',
        'SPEAKER_INACTIVE',
        'MEETING_ENDED'
      ])
    })

    it('emits MEETING_INFO with the thread id (and no subject when Graph gives none)', async () => {
      const h = setup()
      const infos: unknown[] = []
      h.service.on('MEETING_INFO', (i) => infos.push(i))
      h.setPresence('InACall')
      await h.service.pollPresence()
      expect(infos).toEqual([{ meetingId: 'thread-1', subject: null }])
      h.service.stop()
    })
  })

  describe('Graph subscription', () => {
    it('creates a callRecords subscription pointing at the function endpoint with clientState', async () => {
      const h = setup()
      await h.service.start()

      const call = h.fetchFn.mock.calls.find(
        ([u, i]) => String(u).endsWith('/subscriptions') && (i as RequestInit).method === 'POST'
      )
      const body = JSON.parse((call?.[1] as RequestInit).body as string)
      expect(body).toMatchObject({
        changeType: 'created',
        resource: 'communications/callRecords',
        notificationUrl: `${BASE}/api/notifications`,
        clientState: 'secret-state'
      })
      h.service.stop()
    })

    it('renews the subscription every 55 minutes', async () => {
      const h = setup()
      await h.service.start()

      await vi.advanceTimersByTimeAsync(SUBSCRIPTION_RENEW_MS)

      const patch = h.fetchFn.mock.calls.find(
        ([, i]) => (i as RequestInit | undefined)?.method === 'PATCH'
      )
      expect(String(patch?.[0])).toBe('https://graph.microsoft.com/v1.0/subscriptions/sub-1')
      h.service.stop()
    })
  })

  describe('WebSocket relay', () => {
    it('joins the meeting room and sendToMeeting relays START_TRACKING', async () => {
      const h = setup()
      h.setPresence('InACall')
      await h.service.start()
      expect(h.service.sendToMeeting('START_TRACKING')).toBe(true)

      expect(h.socket.sent.map((s) => JSON.parse(s))).toEqual(
        expect.arrayContaining([
          { type: 'JOIN', meetingId: 'thread-1' },
          { type: 'START_TRACKING', meetingId: 'thread-1' }
        ])
      )
      h.service.stop()
    })

    it('sendToMeeting returns false when not in a meeting', async () => {
      const h = setup()
      await h.service.start()
      expect(h.service.sendToMeeting('STOP_TRACKING')).toBe(false)
      h.service.stop()
    })

    it('re-emits host START_TRACKING / STOP_TRACKING received from the hub', async () => {
      const h = setup()
      const seen: string[] = []
      h.service.on('START_TRACKING', () => seen.push('START_TRACKING'))
      await h.service.start()

      h.socket.handlers['message']?.(JSON.stringify({ type: 'START_TRACKING' }))
      h.socket.handlers['message']?.('not json')
      h.socket.handlers['message']?.(JSON.stringify({ type: 'SOMETHING_ELSE' }))

      expect(seen).toEqual(['START_TRACKING'])
      h.service.stop()
    })
  })

  describe('isAllowedSocketUrl', () => {
    it.each([
      ['wss://relay.example.net', true],
      ['ws://127.0.0.1:8081', true],
      ['ws://localhost:8081', true],
      ['ws://relay.example.net', false],
      ['https://relay.example.net', false],
      ['not a url', false]
    ])('%s → %s', (url, allowed) => {
      expect(isAllowedSocketUrl(url)).toBe(allowed)
    })
  })
})
