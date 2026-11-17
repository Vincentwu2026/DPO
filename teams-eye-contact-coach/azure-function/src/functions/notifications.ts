import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext
} from '@azure/functions'
import { getHub } from '../hub/hubSingleton'
import { dispatchNotifications } from '../notifications/dispatch'

export async function notifications(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // Graph subscription handshake: echo the token as plain text (Graph sends it via POST; GET also supported).
  const validationToken = request.query.get('validationToken')
  if (validationToken !== null) {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: validationToken
    }
  }

  if (request.method !== 'POST') return { status: 405 }

  const clientState = process.env['GRAPH_CLIENT_STATE'] ?? ''
  if (!clientState) {
    context.error('GRAPH_CLIENT_STATE is not configured')
    return { status: 500 }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { status: 400 }
  }

  const dispatched = dispatchNotifications(getHub(), body, clientState)
  context.log(`Dispatched ${dispatched} Graph notification(s)`)
  // Graph requires a 202 within 3 seconds.
  return { status: 202 }
}

app.http('notifications', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous', // Graph cannot send function keys; requests are authenticated via clientState.
  route: 'notifications',
  handler: notifications
})
