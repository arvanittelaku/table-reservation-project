import { useCallback, useEffect, useState } from 'react'
import {
  type ChatMessage,
  loadMessages,
  sendMessage as apiSendMessage,
  subscribeMessages,
} from '../api/messages'
import { sb } from '../backendClient'
import { avatarUrl } from '../lib/avatarUrl'

/** A chat message with the sender's signed photo URL. */
export interface ChatMessageWithAvatar extends ChatMessage { sender_photo_url: string | null }

async function withAvatar(message: ChatMessage): Promise<ChatMessageWithAvatar> {
  const path = message.sender?.photo_path ?? null
  const url = await avatarUrl(path)
  return {
    ...message,
    sender_photo_url: url,
  }
}

async function enrichList(rows: ChatMessage[] | null | undefined): Promise<ChatMessageWithAvatar[]> {
  return Promise.all((rows ?? []).map(withAvatar))
}

/**
 * Real-time table chat.
 * Icebreaker (dice) stays UI-only: it fills the input; the user sends manually.
 */
export function useChat(tableId: string | null | undefined) {
  const [messages, setMessages] = useState<ChatMessageWithAvatar[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!tableId) {
      setMessages([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    loadMessages(tableId)
      .then((rows) => enrichList(rows))
      .then((enriched) => {
        if (!cancelled) setMessages(enriched)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const unsubscribe = subscribeMessages(tableId, async (row) => {
      // Realtime payload has no join — fetch sender profile, then sign avatar
      let sender: ChatMessage['sender'] = null
      try {
        const { data } = await sb
          .from('profiles')
          .select('id, first_name, photo_path')
          .eq('id', row.sender_id)
          .maybeSingle()
        sender = data
      } catch {
        sender = null
      }

      const enriched = await withAvatar({ ...row, sender })
      if (cancelled) return

      setMessages((prev) => {
        if (prev.some((m) => m.id === enriched.id)) return prev
        return [...prev, enriched]
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [tableId])

  const sendMessage = useCallback(
    async (body: string) => {
      if (!tableId) throw new Error('No table selected')
      const row = await apiSendMessage(tableId, body)
      const enriched = await withAvatar(row)

      setMessages((prev) => {
        if (prev.some((m) => m.id === enriched.id)) return prev
        return [...prev, enriched]
      })

      return enriched
    },
    [tableId],
  )

  return {
    messages,
    sendMessage,
    loading,
    error,
  }
}
