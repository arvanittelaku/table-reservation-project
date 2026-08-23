/**
 * Local in-app / browser notification helper.
 * Email for new requests is sent by the database trigger — not from here.
 */
export function pushNotif(title, body = '') {
  if (typeof window === 'undefined') return

  // Prefer a custom in-app handler if the UI registered one
  if (typeof window.__ejabashkohuPushNotif === 'function') {
    window.__ejabashkohuPushNotif({ title, body })
    return
  }

  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body })
      return
    } catch {
      // fall through to console
    }
  }

  console.info('[ejabashkohu notif]', title, body)
}
