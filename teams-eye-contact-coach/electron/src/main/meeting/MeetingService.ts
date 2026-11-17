import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

export type MeetingEvent =
  | 'MEETING_STARTED'
  | 'MEETING_ENDED'
  | 'SPEAKER_ACTIVE'
  | 'SPEAKER_INACTIVE'
  | 'START_TRACKING'
  | 'STOP_TRACKING'

export const PRESENCE_POLL_MS = 15_000
export const SPEAKER_POLL_MS = 5_000
export const SUBSCRIPTION_RENEW_MS = 55 * 60_000
const SUBSCRIPTION_LIFETIME_MS = 60 * 60_000
const REQUEST_TIMEOUT_MS = 10_000
const GRAPH_V1 = 'https://graph.microsoft.com/v1.0'
const GRAPH_BETA = 'https://graph.microsoft.com/beta'
const IN_CALL_ACTIVITIES = new Set(['InACall', 'InAConferenceCall'])

export interface MeetingAuth {
  getAccessToken(scopes?: string[]): Promise<string>
  getUserId(): Promise<string | null>
}

export interface MeetingSocket {
  readyState: number
  send(data: string): void
  close(): void
  on(event: 'message', listener: (data: unknown) => void): unknown
  on(event: 'close' | 'error' | 'open', listener: () => void): unknown
}

export interface MeetingServiceOptions {
  auth: MeetingAuth
  /** Base URL of the Azure Function app, e.g. https://my-func.azurewebsites.net */
  functionBaseUrl: string
  /** Shared secret Graph echoes back in each notification; validated by the Azure Function. */
  clientState: string
  fetchFn?: typeof fetch
  createSocket?: (url: string) => MeetingSocket
}

interface GraphCall {
  id?: string
  state?: string
  subject?: string
  chatInfo?: { threadId?: string }
}

export interface MeetingInfo {
  meetingId: string
  subject: string | null
}

interface GraphParticipant {
  isActiveSpeaker?: boolean
  info?: { identity?: { user?: { id?: string } } }
}

const SOCKET_OPEN = 1

export class MeetingService extends EventEmitter {
  private readonly fetchFn: typeof fetch
  private readonly createSocket: (url: string) => MeetingSocket

  private presenceTimer: NodeJS.Timeout | null = null
  private speakerTimer: NodeJS.Timeout | null = null
  private renewTimer: NodeJS.Timeout | null = null
  private socket: MeetingSocket | null = null

  private inCall = false
  private speakerActive = false
  private callId: string | null = null
  private meetingId: string | null = null
  private subscriptionId: string | null = null

  constructor(private readonly options: MeetingServiceOptions) {
    super()
    this.fetchFn = options.fetchFn ?? fetch
    this.createSocket =
      options.createSocket ?? ((url) => new WebSocket(url) as unknown as MeetingSocket)
  }

  /** Begin presence polling, open the relay socket and register the Graph subscription. */
  async start(): Promise<void> {
    if (this.presenceTimer) return
    this.presenceTimer = setInterval(() => void this.pollPresence(), PRESENCE_POLL_MS)
    await Promise.allSettled([this.connectSocket(), this.ensureSubscription(), this.pollPresence()])
    this.renewTimer = setInterval(() => void this.renewSubscription(), SUBSCRIPTION_RENEW_MS)
  }

  stop(): void {
    for (const t of [this.presenceTimer, this.speakerTimer, this.renewTimer]) {
      if (t) clearInterval(t)
    }
    this.presenceTimer = this.speakerTimer = this.renewTimer = null
    this.socket?.close()
    this.socket = null
    this.inCall = false
    this.speakerActive = false
    this.callId = this.meetingId = null
  }

  /** Send a message to the relay hub for the current meeting (e.g. START_TRACKING / STOP_TRACKING). */
  sendToMeeting(type: string, payload?: unknown): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN || !this.meetingId) return false
    this.socket.send(JSON.stringify({ type, meetingId: this.meetingId, payload }))
    return true
  }

  // ---- Presence ----------------------------------------------------------------------------

  async pollPresence(): Promise<void> {
    try {
      const userId = await this.options.auth.getUserId()
      if (!userId) return
      const presence = await this.graphGet<{ activity?: string }>(
        `${GRAPH_V1}/users/${encodeURIComponent(userId)}/presence`
      )
      const nowInCall = IN_CALL_ACTIVITIES.has(presence.activity ?? '')
      if (nowInCall && !this.inCall) {
        this.inCall = true
        this.emit('MEETING_STARTED')
        await this.attachToCall()
      } else if (!nowInCall && this.inCall) {
        this.inCall = false
        this.detachFromCall()
        this.emit('MEETING_ENDED')
      }
    } catch (err) {
      console.error('Presence poll failed', errorSummary(err))
    }
  }

  // ---- Active speaker ----------------------------------------------------------------------

  private async attachToCall(): Promise<void> {
    try {
      const calls = await this.graphGet<{ value?: GraphCall[] }>(
        `${GRAPH_BETA}/communications/calls`
      )
      const call =
        calls.value?.find((c) => c.id && (!c.state || c.state === 'established')) ??
        calls.value?.[0]
      if (!call?.id) return
      this.callId = call.id
      this.meetingId = call.chatInfo?.threadId ?? call.id
      this.joinRoom()
      this.emit('MEETING_INFO', {
        meetingId: this.meetingId,
        subject:
          typeof call.subject === 'string' && call.subject ? call.subject.slice(0, 200) : null
      } satisfies MeetingInfo)
      if (this.inCall && !this.speakerTimer) {
        this.speakerTimer = setInterval(() => void this.pollActiveSpeaker(), SPEAKER_POLL_MS)
      }
    } catch (err) {
      console.error('Call lookup failed', errorSummary(err))
    }
  }

  private detachFromCall(): void {
    if (this.speakerTimer) clearInterval(this.speakerTimer)
    this.speakerTimer = null
    if (this.speakerActive) {
      this.speakerActive = false
      this.emit('SPEAKER_INACTIVE')
    }
    this.callId = this.meetingId = null
  }

  async pollActiveSpeaker(): Promise<void> {
    if (!this.callId) return
    try {
      const userId = await this.options.auth.getUserId()
      const res = await this.graphGet<{ value?: GraphParticipant[] }>(
        `${GRAPH_BETA}/communications/calls/${encodeURIComponent(this.callId)}/participants`
      )
      const active = (res.value ?? []).some(
        (p) => p.isActiveSpeaker === true && p.info?.identity?.user?.id === userId
      )
      if (active !== this.speakerActive) {
        this.speakerActive = active
        this.emit(active ? 'SPEAKER_ACTIVE' : 'SPEAKER_INACTIVE')
      }
    } catch (err) {
      console.error('Active-speaker poll failed', errorSummary(err))
    }
  }

  // ---- Graph change-notification subscription --------------------------------------------

  async ensureSubscription(): Promise<void> {
    try {
      const res = await this.graphSend<{ id?: string }>('POST', `${GRAPH_V1}/subscriptions`, {
        changeType: 'created',
        notificationUrl: `${this.options.functionBaseUrl}/api/notifications`,
        resource: 'communications/callRecords',
        expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString(),
        clientState: this.options.clientState
      })
      this.subscriptionId = res.id ?? null
    } catch (err) {
      console.error('Subscription creation failed', errorSummary(err))
    }
  }

  async renewSubscription(): Promise<void> {
    if (!this.subscriptionId) return this.ensureSubscription()
    try {
      await this.graphSend(
        'PATCH',
        `${GRAPH_V1}/subscriptions/${encodeURIComponent(this.subscriptionId)}`,
        {
          expirationDateTime: new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS).toISOString()
        }
      )
    } catch (err) {
      console.error('Subscription renewal failed; recreating', errorSummary(err))
      this.subscriptionId = null
      await this.ensureSubscription()
    }
  }

  // ---- WebSocket relay ---------------------------------------------------------------------

  private async connectSocket(): Promise<void> {
    const res = await this.fetchFn(`${this.options.functionBaseUrl}/api/connect-info`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`connect-info failed: ${res.status}`)
    const { url } = (await res.json()) as { url?: unknown }
    if (typeof url !== 'string' || !isAllowedSocketUrl(url)) throw new Error('Rejected relay URL')

    const socket = this.createSocket(url)
    this.socket = socket
    socket.on('open', () => this.joinRoom())
    socket.on('message', (data) => this.handleSocketMessage(String(data)))
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
    })
    socket.on('error', () => undefined)
  }

  private joinRoom(): void {
    if (this.socket?.readyState === SOCKET_OPEN && this.meetingId) {
      this.socket.send(JSON.stringify({ type: 'JOIN', meetingId: this.meetingId }))
    }
  }

  private handleSocketMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { type?: unknown }
      if (msg.type === 'START_TRACKING' || msg.type === 'STOP_TRACKING') this.emit(msg.type)
    } catch {
      // ignore malformed relay messages
    }
  }

  // ---- Graph helpers -----------------------------------------------------------------------

  private graphGet<T>(url: string): Promise<T> {
    return this.graphSend<T>('GET', url)
  }

  private async graphSend<T>(method: string, url: string, body?: unknown): Promise<T> {
    const token = await this.options.auth.getAccessToken()
    const res = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`Graph ${method} failed: ${res.status}`)
    return (res.status === 204 ? {} : await res.json()) as T
  }
}

/** wss:// only, except plain ws:// to loopback for local development. */
export function isAllowedSocketUrl(value: string): boolean {
  try {
    const u = new URL(value)
    if (u.protocol === 'wss:') return true
    return u.protocol === 'ws:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
  } catch {
    return false
  }
}

/** Log only a message — never tokens, headers or response bodies. */
function errorSummary(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error'
}
