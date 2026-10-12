import { sb } from '../backendClient'
import { throwDb } from '../lib/errors'

/** Call a database function and return its result; failures throw a CodedError. */
export async function callRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc<T>(name, args)
  if (error) throwDb(error)
  return data
}

/** The signed-in user's id from the saved session (no network), or null. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await sb.auth.getSession()
  return data.session?.user?.id ?? null
}
