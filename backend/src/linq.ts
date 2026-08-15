// Owns the Linq Partner API v2 send. Token stays here — the frontend never
// sees it. Docs: https://docs.linqapp.com/v2/
//
// Safety rails, in order:
// - live only when token + send_from + test phone are ALL configured
// - every send goes to LINQ_TEST_PHONE only, never to arbitrary numbers
// - the frontend engine additionally limits itself to one real send/session

import { LINQ_INTEGRATION_TOKEN, LINQ_SEND_FROM, LINQ_TEST_PHONE, STRIPE_PAYMENT_LINK } from './env.ts'

const BASE = 'https://api.linqapp.com'

export interface LinqSendResult {
  live: boolean
  chatId: string | null
  messageId: string | null
  service: string | null // imessage | rcs | sms — whatever Linq negotiated
  deliveryStatus: string | null
  error: string | null
}

// "+1 (212) 555-0123" → "+12125550123" (E.164, what the API requires)
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return '+' + (digits.length === 10 ? '1' + digits : digits)
}

export function isLinqLive(): boolean {
  return Boolean(LINQ_INTEGRATION_TOKEN && toE164(LINQ_TEST_PHONE))
}

export function paymentLink(): string | null {
  return STRIPE_PAYMENT_LINK.startsWith('http') ? STRIPE_PAYMENT_LINK : null
}

export function onboardText(link: string): string {
  return [
    "You're in. Bob the Busines — the company that runs itself.",
    `Subscribe: ${link}`,
    'Product: https://github.com/AliUraish/Buisness_Agent',
  ].join('\n')
}

export async function sendOnboard(): Promise<LinqSendResult & { text: string | null }> {
  const link = paymentLink()
  if (!link) {
    return {
      live: isLinqLive(),
      chatId: null,
      messageId: null,
      service: null,
      deliveryStatus: null,
      error: 'Set STRIPE_PAYMENT_LINK=https://buy.stripe.com/… in the workspace .env.',
      text: null,
    }
  }
  const text = onboardText(link)
  return { ...(await sendSupportMessage(text)), text }
}

// the org's messaging-enabled number, discovered once and cached
let orgNumberCache: string | null = null
async function orgNumber(): Promise<string | null> {
  if (orgNumberCache) return orgNumberCache
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 10000)
    const res = await fetch(`${BASE}/api/partner/v3/phone_numbers`, {
      headers: { Authorization: `Bearer ${LINQ_INTEGRATION_TOKEN}` },
      signal: ctl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return null
    const json: any = await res.json()
    const healthy = (json?.phone_numbers ?? []).find(
      (p: any) => p?.phone_number && (p?.reputation?.status ?? 'HEALTHY') === 'HEALTHY',
    )
    orgNumberCache = healthy?.phone_number ?? json?.phone_numbers?.[0]?.phone_number ?? null
    return orgNumberCache
  } catch {
    return null
  }
}

export async function sendSupportMessage(text: string): Promise<LinqSendResult> {
  if (!isLinqLive()) {
    return {
      live: false,
      chatId: null,
      messageId: null,
      service: null,
      deliveryStatus: null,
      error: 'Set LINQ_API_KEY and LINQ_TEST_PHONE (+1…) in the workspace .env, then restart the backend.',
    }
  }

  // Partner API v3: Bearer auth, from/to/message.parts. `from` must be the
  // org's E.164 number — if LINQ_SEND_FROM isn't one (e.g. an email), we
  // auto-discover the org's messaging number and cache it.
  const from = toE164(LINQ_SEND_FROM) ?? (await orgNumber())
  if (!from) {
    return {
      live: true,
      chatId: null,
      messageId: null,
      service: null,
      deliveryStatus: null,
      error: 'No sending number: LINQ_SEND_FROM is not a phone and the org has no messaging-enabled numbers.',
    }
  }
  const body = {
    from,
    to: [toE164(LINQ_TEST_PHONE)],
    message: { parts: [{ type: 'text', value: text.slice(0, 1000) }] },
  }

  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch(`${BASE}/api/partner/v3/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LINQ_INTEGRATION_TOKEN}`,
      },
      signal: ctl.signal,
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    let json: any = null
    try {
      json = raw ? JSON.parse(raw) : null
    } catch {
      json = { raw }
    }
    if (!res.ok) {
      const e = json?.error ?? json?.errors ?? json?.message ?? raw.slice(0, 240)
      const msg = typeof e === 'string' ? e : JSON.stringify(e).slice(0, 240)
      return { live: true, chatId: null, messageId: null, service: null, deliveryStatus: null, error: `Linq ${res.status}: ${msg}` }
    }
    const chat = json?.chat ?? json?.data ?? json
    const message = json?.message ?? chat?.message ?? (Array.isArray(chat?.messages) ? chat.messages[0] : null)
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
