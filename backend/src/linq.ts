// Owns the Linq Partner API v2 send. Token stays here — the frontend never
// sees it. Docs: https://docs.linqapp.com/v2/
//
// Safety rails, in order:
// - live only when token + send_from + test phone are ALL configured
// - every send goes to LINQ_TEST_PHONE only, never to arbitrary numbers
// - the frontend engine additionally limits itself to one real send/session

import { LINQ_INTEGRATION_TOKEN, LINQ_SEND_FROM, LINQ_TEST_PHONE } from './env.ts'

const BASE = 'https://api.linqapp.com'

export interface LinqSendResult {
  live: boolean
  chatId: string | null
  messageId: string | null
  service: string | null // imessage | rcs | sms — whatever Linq negotiated
  deliveryStatus: string | null
  error: string | null
}

export function isLinqLive(): boolean {
  return Boolean(LINQ_INTEGRATION_TOKEN && LINQ_SEND_FROM && LINQ_TEST_PHONE)
}

export async function sendSupportMessage(text: string): Promise<LinqSendResult> {
  if (!isLinqLive()) {
    return {
      live: false,
      chatId: null,
      messageId: null,
      service: null,
      deliveryStatus: null,
      error:
        'Set LINQ_INTEGRATION_TOKEN, LINQ_SEND_FROM (+1…), and LINQ_TEST_PHONE (+1…) in the workspace .env, then restart the backend.',
    }
  }

  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch(`${BASE}/api/partner/v2/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-LINQ-INTEGRATION-TOKEN': LINQ_INTEGRATION_TOKEN,
      },
      signal: ctl.signal,
      body: JSON.stringify({
        send_from: LINQ_SEND_FROM,
        chat: { phone_numbers: [LINQ_TEST_PHONE] },
        message: { text: text.slice(0, 1000) },
      }),
    })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!res.ok) {
      const msg = json?.error ?? json?.message ?? raw.slice(0, 180)
      return { live: true, chatId: null, messageId: null, service: null, deliveryStatus: null, error: `Linq ${res.status}: ${msg}` }
    }
    const chat = json?.chat ?? json
    const message = json?.message ?? chat?.message ?? null
    return {
      live: true,
      chatId: chat?.id != null ? String(chat.id) : null,
      messageId: message?.id != null ? String(message.id) : null,
      service: chat?.service ?? message?.service ?? null,
      deliveryStatus: message?.delivery_status ?? null,
      error: null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { live: true, chatId: null, messageId: null, service: null, deliveryStatus: null, error: `Linq request failed: ${msg.slice(0, 140)}` }
  } finally {
    clearTimeout(t)
  }
}
