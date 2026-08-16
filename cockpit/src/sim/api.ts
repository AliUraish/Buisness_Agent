// Production builds talk to the Render backend via VITE_API_URL.
// Local Vite keeps this empty so /api stays same-origin and hits the proxy.
const raw = String(import.meta.env.VITE_API_URL ?? '').trim().replace(/\/$/, '')
export const API_ORIGIN = !raw ? '' : raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return API_ORIGIN + p
}
