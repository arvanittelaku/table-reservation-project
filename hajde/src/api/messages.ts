import { sb } from '../backendClient'
import { currentUserId } from './rpc'
import { throwDb } from '../lib/errors'
import type { MessageRow, ProfileRow } from '../types/db'

/** A chat message with its sender's name and photo. */
export interface ChatMessage extends MessageRow {
  sender: Pick<ProfileRow, 'id' | 'first_name' | 'photo_path'> | null
}

/**
 * Send a chat message. RLS allows inserts only for confirmed members.
 */
export async function sendMessage(tableId: string, body: unknown): Promise<ChatMessage> {
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
    .returns<ChatMessage>()
    .single()

  if (error) throwDb(error)
  return data
}

/**
 * Last 100 messages for a table, oldest → newest, with sender profile.
 */
export async function loadMessages(tableId: string): Promise<ChatMessage[]> {
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
    .returns<ChatMessage>()
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
export function subscribeMessages(tableId: string, onNew: (row: MessageRow) => void): () => void {
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
        if (payload.new) onNew(payload.new)
      },
    )
    .subscribe()

  return () => {
    void sb.removeChannel(channel)
  }
}
