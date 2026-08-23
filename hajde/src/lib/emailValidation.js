/** Client-side email format validation (no mailbox verification). */
export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isEmailFormatValid(email) {
  const trimmed = (email || '').trim()
  if (!trimmed) return false
  return EMAIL_FORMAT_RE.test(trimmed)
}

export function emailDomainPart(email) {
  const trimmed = (email || '').trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at < 1) return null
  return trimmed.slice(at + 1) || null
}
