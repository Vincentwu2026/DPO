import { app, type HttpResponseInit } from '@azure/functions'
import { getHub } from '../hub/hubSingleton'

export function connectInfo(): HttpResponseInit {
  getHub() // ensure the embedded WebSocket server is running
  const url = process.env['WS_PUBLIC_URL'] ?? `ws://127.0.0.1:${process.env['WS_PORT'] ?? '8081'}`
  return { status: 200, jsonBody: { url } }
}

app.http('connectInfo', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'connect-info',
  handler: connectInfo
})
