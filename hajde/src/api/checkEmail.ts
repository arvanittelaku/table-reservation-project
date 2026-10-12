import { sb } from '../backendClient'
import { emailDomainPart, isEmailFormatValid } from '../lib/emailValidation'

const DOH_URL = 'https://cloudflare-dns.com/dns-query'

type DohAnswer = { Answer?: unknown[] }
export interface EmailDomainCheck { valid: boolean; reason?: string; domain?: string; via?: 'edge' | 'doh_fallback' }

/** Browser fallback when Edge Function is not deployed yet. */
async function checkDomainMxViaDoh(domain: string): Promise<boolean> {
  const url = `${DOH_URL}?name=${encodeURIComponent(domain)}&type=MX`
  const res = await fetch(url, { headers: { Accept: 'application/dns-json' } })
  if (!res.ok) return false
  const data = (await res.json()) as DohAnswer
  if (Array.isArray(data.Answer) && data.Answer.length > 0) return true

  const aRes = await fetch(`${DOH_URL}?name=${encodeURIComponent(domain)}&type=A`, {
    headers: { Accept: 'application/dns-json' },
  })
  if (!aRes.ok) return false
  const aData = (await aRes.json()) as DohAnswer
  return Array.isArray(aData.Answer) && aData.Answer.length > 0
}

/**
 * Verify the email domain has MX records (can receive mail).
 * Does NOT verify the specific mailbox exists.
 */
export async function checkEmailDomain(email: string): Promise<EmailDomainCheck> {
  const trimmed = (email || '').trim()
  if (!isEmailFormatValid(trimmed)) {
    return { valid: false, reason: 'format' }
  }

  const domain = emailDomainPart(trimmed)
  if (!domain) return { valid: false, reason: 'format' }

  const { data, error } = await sb.functions.invoke<{ valid?: boolean; reason?: string }>('check-email-domain', {
    body: { email: trimmed },
  })

  if (!error && data?.valid === true) {
    return { valid: true, domain, via: 'edge' }
  }

  if (error) {
    console.warn('[ejaBashkohu] check-email-domain edge unavailable, using DNS fallback:', error.message)
    try {
      const valid = await checkDomainMxViaDoh(domain)
      return valid
        ? { valid: true, domain, via: 'doh_fallback' }
        : { valid: false, reason: 'no_mx', domain, via: 'doh_fallback' }
    } catch (dohErr) {
      console.error('[ejaBashkohu] DNS fallback failed:', dohErr)
      return { valid: false, reason: 'lookup_failed', domain }
    }
  }

  return { valid: false, reason: data?.reason || 'no_mx', domain, via: 'edge' }
}
