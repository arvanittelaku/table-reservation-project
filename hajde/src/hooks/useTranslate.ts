import { useCallback, useState } from 'react'
import { translateText, type TranslateOptions } from '../api/translate'

/**
 * Translate-button state: call `translate(text, options)` and use `loading` for a spinner.
 */
export function useTranslate() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const translate = useCallback(async (text: string, options?: TranslateOptions) => {
    setLoading(true)
    setError(null)
    try {
      return await translateText(text, options)
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { translate, loading, error }
}
