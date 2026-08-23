import { t as translate, detectLocale } from '../i18n/index.js'

/** Maps server/client error message → i18n key under errors.* */
const ERROR_KEY_MAP = {
  'Invalid login credentials': 'errors.invalidCredentials',
  'Email not confirmed': 'errors.emailNotConfirmed',
  'User already registered': 'errors.emailAlreadyRegistered',
  'You must be 18 or older to join ejaBashkohu': 'errors.mustBe18',
  'Regjistrimi dështoi. Provo sërish': 'errors.registrationFailed',
  'Password should be at least 6 characters': 'errors.passwordMinLength',
  'Signup requires a valid password': 'errors.passwordInvalid',
  'Email rate limit exceeded': 'errors.emailRateLimitExceeded',
  'Invalid email': 'errors.invalidEmail',

  'Tavolina nuk ekziston ose është mbyllur': 'errors.tableNotAvailable',
  'Kjo tavolinë ka skaduar': 'errors.tableExpired',
  'Je vetë nikoqiri': 'errors.cannotJoinOwnTable',
  'Veprimi nuk lejohet': 'errors.actionNotAllowed',
  'Tavolina është plot. Futu në listën e pritjes': 'errors.tableFullJoinWaitlist',
  "S'je i aprovuar për këtë vozitje": 'errors.notApprovedForRide',
  'Vetëm nikoqiri mund të aprovojë': 'errors.onlyHostCanApprove',
  'Pagesë pa aprovim. Refuzohet': 'errors.paymentWithoutApproval',
  'Ulëset u mbushën': 'errors.seatsFilled',
  'Kërkesa nuk u gjet': 'errors.requestNotFound',

  'You must be signed in to open a table': 'errors.mustSignInOpenTable',
  'You must be signed in to join the waitlist': 'errors.mustSignInWaitlist',
  'You must be signed in': 'errors.mustSignIn',
  'You must be signed in to chat': 'errors.mustSignInChat',
  'You must be signed in to pay': 'errors.mustSignInPay',
  'You must be signed in to upload a photo': 'errors.mustSignInUploadPhoto',
  'You must be signed in to save your taste profile': 'errors.mustSignInSaveTaste',
  'You must be signed in to translate': 'errors.mustSignInTranslate',
  'Message cannot be empty': 'errors.messageEmpty',
  'Not signed in': 'errors.notSignedIn',
  'Nothing to translate': 'errors.nothingToTranslate',
  'Translation failed': 'errors.translationFailed',
  'No file provided': 'errors.noFileProvided',
  'Failed to fetch': 'errors.networkError',
  NetworkError: 'errors.networkError',

  'Teksti është bosh': 'errors.messageEmpty',
  'Mesazhi është tashmë në gjuhën tënde': 'errors.alreadyInYourLanguage',
  'Përkthimi dështoi. Provo sërish.': 'errors.translationFailed',
  'Message is already in your language': 'errors.alreadyInYourLanguage',
  'Translation failed. Try again.': 'errors.translationFailed',
  'Session mismatch. Restart registration': 'errors.restartRegistrationFromStep1',
  'Photo save failed': 'errors.photoUploadFailed',
}

function tr(locale, key, vars) {
  return translate(locale, key, vars)
}

function isPasswordResetRateLimitError(err) {
  if (!err) return false
  const code = err.code || err.error_code
  const msg = (err.message || err.msg || err.error_description || '').toLowerCase()
  if (code === 'over_email_send_rate_limit') return true
  if (msg.includes('only request this after')) return true
  if (msg.includes('email rate limit exceeded')) return true
  return false
}

/** Seconds until another password-reset email can be requested (from Supabase 429 body). */
export function parseResetRateLimitSeconds(err) {
  const msg = err?.message || err?.msg || err?.error_description || ''
  const match = String(msg).match(/after (\d+) seconds/i)
  return match ? Number(match[1]) : null
}

export function mapPasswordResetRateLimitError(err, locale = detectLocale()) {
  if (!isPasswordResetRateLimitError(err)) return null
  const seconds = parseResetRateLimitSeconds(err) ?? 60
  return tr(locale, 'errors.passwordResetRateLimit', { seconds })
}

/**
 * Map Supabase / RPC / network errors to locale-aware user copy.
 */
export function mapError(err, locale = detectLocale()) {
  if (!err) return tr(locale, 'errors.genericError')

  const rateLimitMsg = mapPasswordResetRateLimitError(err, locale)
  if (rateLimitMsg) return rateLimitMsg

  const msg = (err?.message || err?.error_description || String(err)).trim()
  if (!msg) return tr(locale, 'errors.genericError')

  if (ERROR_KEY_MAP[msg]) return tr(locale, ERROR_KEY_MAP[msg])

  const code = err?.code
  const lower = msg.toLowerCase()

  if (code === '42501' && lower.includes('row-level security') && lower.includes('tables')) {
    return tr(locale, 'errors.tableCreateRlsFailed')
  }
  if (code === '23502' && lower.includes('event_datetime')) {
    return tr(locale, 'errors.pickDateTime')
  }
  if (code === '23514' && lower.includes('maps_link')) {
    return tr(locale, 'errors.mapsLinkInvalid')
  }
  if (lower.includes('event_datetime') && (lower.includes('check constraint') || lower.includes('violates'))) {
    return tr(locale, 'errors.pickDateTime')
  }

  if (lower.includes('tavolina') && lower.includes('plot') && lower.includes('pritjes')) {
    return tr(locale, 'errors.tableFullJoinWaitlist')
  }

  for (const [key, i18nKey] of Object.entries(ERROR_KEY_MAP)) {
    if (lower.includes(key.toLowerCase())) return tr(locale, i18nKey)
  }

  return tr(locale, 'errors.genericError')
}
