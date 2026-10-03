import { getSessionUser } from '../lib/session'
import { sb } from '../backendClient'

async function currentUserId() {
  const { data, error } = await getSessionUser()
  if (error || !data.user) return null
  return data.user.id
}

function throwDb(error) {
  const e = new Error(error?.message || String(error))
  if (error?.code) e.code = error.code
  throw e
}

/**
 * Send a chat message. RLS allows inserts only for confirmed members.
 */
export async function sendMessage(tableId, body) {
  const text = String(body ?? '').trim()
  if (!text) throw new Error('Message cannot be empty')

  const userId = await currentUserId()
  if (!userId) throw new Error('You must be signed in to chat')

  const { data, error } = await sb
    .from('messages')
    .insert({
      table_id: tableId,
      sender_id: userId,
      body: text,
    })
    .select(
      `
      id,
      table_id,
      sender_id,
      body,
      created_at,
      sender:profiles!messages_sender_id_fkey (
        id,
        first_name,
        photo_path
      )
    `,
    )
    .single()

  if (error) throwDb(error)
  return data
}

/**
 * Last 100 messages for a table, oldest → newest, with sender profile.
 */
export async function loadMessages(tableId) {
  const { data, error } = await sb
    .from('messages')
    .select(
      `
      id,
      table_id,
      sender_id,
      body,
      created_at,
      sender:profiles!messages_sender_id_fkey (
        id,
        first_name,
        photo_path
      )
    `,
    )
    .eq('table_id', tableId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throwDb(error)

  // Return chronological order for the chat UI
  return (data ?? []).reverse()
}

/**
 * Realtime INSERT subscription for a table's messages.
 * onNew receives the new row (without joined profile — caller may refetch or merge).
 * Returns an unsubscribe function.
 */
export function subscribeMessages(tableId, onNew) {
  const channel = sb
    .channel(`chat-${tableId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `table_id=eq.${tableId}`,
      },
      (payload) => {
        onNew(payload.new)
      },
    )
    .subscribe((status) => {
      console.log('[ejaBashkohu] Chat channel status:', status)
    })

  return () => {
    sb.removeChannel(channel)
  }
}
