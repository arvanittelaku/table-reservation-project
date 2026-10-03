import { sb } from '../backendClient'

/**
 * Same shape as sb.auth.getUser(), but reads the locally stored session
 * instead of calling the Auth server. getUser() is a network round-trip on
 * every call; the API helpers only need the user id (RLS still checks the
 * JWT on every request), so this saves one request per database call.
 */
export async function getSessionUser() {
  const { data, error } = await sb.auth.getSession()
  return { data: { user: data?.session?.user ?? null }, error }
}
