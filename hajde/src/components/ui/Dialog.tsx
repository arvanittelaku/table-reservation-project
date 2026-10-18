import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import './dialog.css'

/* In-app replacements for window.confirm / window.prompt: same look as the rest of the app,
 * never blocked by in-app browsers, readable by screen readers.
 *
 *   if (!(await confirmDialog(t('…'), { confirmLabel: t('…'), danger: true }))) return
 *   await copyDialog(t('share.copyPrompt'), url)
 *
 * <DialogHost /> is mounted once (main.tsx). Without it the functions fall back to the browser's own dialogs. */

type ConfirmOpts = { confirmLabel?: string; danger?: boolean }
type Req =
  | ({ kind: 'confirm'; message: string; resolve: (ok: boolean) => void } & ConfirmOpts)
  | { kind: 'copy'; message: string; value: string; resolve: () => void }

let push: ((r: Req) => void) | null = null

export function confirmDialog(message: string, opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.confirm(message)); return }
    push({ kind: 'confirm', message, resolve, ...opts })
  })
}

export function copyDialog(message: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    if (!push) { window.prompt(message, value); resolve(); return }
    push({ kind: 'copy', message, value, resolve })
  })
}

export function DialogHost() {
  const { t } = useI18n()
  const [queue, setQueue] = useState<Req[]>([])
  const okRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r])
    return () => { push = null }
  }, [])

  const cur = queue[0]
  const close = (ok: boolean) => {
    if (!cur) return
    if (cur.kind === 'confirm') cur.resolve(ok); else cur.resolve()
    setQueue((q) => q.slice(1))
  }

  // focus: the safe choice for destructive questions, the main button otherwise
  useEffect(() => {
    if (!cur) return
    if (cur.kind === 'copy') { inputRef.current?.focus(); inputRef.current?.select(); return }
    ;(cur.danger ? cancelRef : okRef).current?.focus()
  }, [cur])

  useEffect(() => {
    if (!cur) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  if (!cur) return null
  return (
    <div className="dlg-scrim" onClick={() => close(false)}>
      <div
        className="dlg"
        role={cur.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={cur.message}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="dlg-msg">{cur.message}</p>
        {cur.kind === 'copy' && (
          <input ref={inputRef} className="dlg-input" readOnly value={cur.value} onFocus={(e) => e.currentTarget.select()} />
        )}
        <div className="dlg-actions">
          {cur.kind === 'confirm' ? (
            <>
              <button ref={cancelRef} type="button" className="dlg-btn" onClick={() => close(false)}>{t('app.cancel')}</button>
              <button ref={okRef} type="button" className={`dlg-btn primary${cur.danger ? ' danger' : ''}`} onClick={() => close(true)}>
                {cur.confirmLabel || t('app.confirm')}
              </button>
            </>
          ) : (
            <button type="button" className="dlg-btn primary" onClick={() => close(true)}>{t('app.close')}</button>
          )}
        </div>
      </div>
    </div>
  )
}
