import { WsHub } from './WsHub'

let hub: WsHub | null = null

/** Lazily creates the process-wide hub and starts its WebSocket server (loopback by default). */
export function getHub(): WsHub {
  if (!hub) {
    hub = new WsHub()
    hub.start(process.env['WS_HOST'] ?? '127.0.0.1', Number(process.env['WS_PORT'] ?? 8081))
  }
  return hub
}
