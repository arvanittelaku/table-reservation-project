/** Parse Supabase auth redirect errors from the URL hash (otp_expired, etc.). */
export function parseAuthHashError() {
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  if (!raw) return null

  const params = new URLSearchParams(raw)
  const errorType = params.get('error')
  const errorCode = params.get('error_code')

  if (errorType === 'access_denied' && errorCode === 'otp_expired') {
    return {
      errorType,
      errorCode,
      description: params.get('error_description'),
    }
  }

  return null
}

/** Remove auth hash fragments so refresh does not re-trigger handling. */
export function clearAuthHashFromUrl() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}
