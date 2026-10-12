/** An Error carrying the backend's error code (Postgres SQLSTATE, PGRST…, auth error_code). */
export interface CodedError extends Error {
  code?: string
  status?: number
  error_code?: string
  weak_password?: unknown
}

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; error_code?: unknown; weak_password?: unknown; name?: unknown }

/** Read error fields from anything that was thrown or returned. */
export function errorFields(err: unknown): ErrorLike {
  return err && typeof err === 'object' ? (err as ErrorLike) : {}
}

export function errorMessage(err: unknown): string {
  const m = errorFields(err).message
  return typeof m === 'string' ? m : err == null ? '' : String(err)
}

export function errorCode(err: unknown): string | undefined {
  const c = errorFields(err).code
  return typeof c === 'string' ? c : undefined
}

/** new Error(message) with the code/error_code of `source` copied over. */
export function codedError(source: unknown, fallbackMessage?: string): CodedError {
  const f = errorFields(source)
  const e: CodedError = new Error(errorMessage(source) || fallbackMessage || 'Error')
  if (typeof f.code === 'string' && f.code) e.code = f.code
  if (typeof f.error_code === 'string' && f.error_code) e.error_code = f.error_code
  if (f.weak_password) e.weak_password = f.weak_password
  return e
}

/** Throw a CodedError built from a backend error. */
export function throwDb(error: unknown): never {
  throw codedError(error)
}
