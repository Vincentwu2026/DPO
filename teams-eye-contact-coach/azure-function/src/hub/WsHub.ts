import { WebSocketServer, type WebSocket } from 'ws'

export interface HubMessage {
  type: string
  payload?: unknown
}

export type HubClient = Pick<WebSocket, 'send' | 'close' | 'on'> & { readyState: number }

const OPEN = 1
const MEETING_ID_PATTERN = /^[\w:@.-]{1,256}$/
const HOST_COMMANDS = new Set(['START_TRACKING', 'STOP_TRACKING'])
const MAX_PAYLOAD_BYTES = 16 * 1024

export function isValidMeetingId(value: unknown): value is string {
  return typeof value === 'string' && MEETING_ID_PATTERN.test(value)
}

/**
 * In-process WebSocket hub. Clients join a meeting room with `{ type: "JOIN", meetingId }`.
 * MVP only: replace with Azure Web PubSub in production.
 */
export class WsHub {
  private readonly rooms = new Map<string, Set<HubClient>>()
  private readonly clientRoom = new Map<HubClient, string>()
  private server: WebSocketServer | null = null

  start(host: string, port: number): void {
    if (this.server) return
    this.server = new WebSocketServer({ host, port, maxPayload: MAX_PAYLOAD_BYTES })
    this.server.on('connection', (socket) => this.handleConnection(socket))
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.rooms.clear()
    this.clientRoom.clear()
  }

  handleConnection(client: HubClient): void {
    client.on('message', (data: unknown) => this.handleMessage(client, String(data)))
    client.on('close', () => this.leave(client))
    client.on('error', () => this.leave(client))
  }

  clientCount(meetingId: string): number {
    return this.rooms.get(meetingId)?.size ?? 0
  }

  /** Send `{ type, payload }` to every open client in a meeting, optionally excluding one. */
  broadcast(meetingId: string, message: HubMessage, except?: HubClient): number {
    const room = this.rooms.get(meetingId)
    if (!room) return 0
    const data = JSON.stringify({ type: message.type, payload: message.payload })
    let sent = 0
    for (const client of room) {
      if (client === except || client.readyState !== OPEN) continue
      client.send(data)
      sent++
    }
    return sent
  }

  private handleMessage(client: HubClient, raw: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof msg !== 'object' || msg === null) return
    const { type, meetingId } = msg as { type?: unknown; meetingId?: unknown }
    if (!isValidMeetingId(meetingId) || typeof type !== 'string') return

    if (type === 'JOIN') {
      this.join(client, meetingId)
      client.send(JSON.stringify({ type: 'JOINED', payload: { meetingId } }))
      return
    }
    // Only members of a meeting may relay host commands into it.
    if (HOST_COMMANDS.has(type) && this.clientRoom.get(client) === meetingId) {
      this.broadcast(meetingId, { type, payload: { meetingId } }, client)
    }
  }

  private join(client: HubClient, meetingId: string): void {
    this.leave(client)
    let room = this.rooms.get(meetingId)
    if (!room) {
      room = new Set()
      this.rooms.set(meetingId, room)
    }
    room.add(client)
    this.clientRoom.set(client, meetingId)
  }

  private leave(client: HubClient): void {
    const meetingId = this.clientRoom.get(client)
    if (meetingId === undefined) return
    this.clientRoom.delete(client)
    const room = this.rooms.get(meetingId)
    room?.delete(client)
    if (room?.size === 0) this.rooms.delete(meetingId)
  }
}
