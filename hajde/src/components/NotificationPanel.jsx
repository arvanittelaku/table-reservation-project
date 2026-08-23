import { useI18n } from '../i18n/I18nContext.jsx'
import { useNotifications } from '../hooks/useNotifications'

/**
 * Notification panel content: Auth email line, email ON/OFF toggle, list + badge helpers.
 */
export function NotificationPanel({ className = '' }) {
  const { t } = useI18n()
  const {
    notifs,
    unread,
    markRead,
    clearNotifs,
    loading,
    authEmail,
    emailEnabled,
    emailSaving,
    toggleEmailNotifications,
  } = useNotifications()

  return (
    <div className={className}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>
          {t('notifications.title')}{' '}
          {unread > 0 ? (
            <span style={{ color: '#c0392b' }}>{t('notifications.unreadCount', { count: unread })}</span>
          ) : null}
        </strong>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="notif-clear" onClick={() => { void clearNotifs(); void markRead(); }}>
            {t('notifications.clearAll')}
          </button>
          {unread > 0 && (
            <button type="button" onClick={() => markRead()}>
              {t('notifications.markRead')}
            </button>
          )}
        </span>
      </div>

      <p style={{ fontSize: 13, margin: '10px 0 6px', color: '#555' }}>
        {t('notifications.emailLine')}{' '}
        <strong>{authEmail || '-'}</strong>
      </p>

      <button
        type="button"
        onClick={() => toggleEmailNotifications()}
        disabled={emailSaving}
        style={{ marginBottom: 12 }}
      >
        {t('notifications.emailToggle', {
          state: emailEnabled ? t('notifications.emailOn') : t('notifications.emailOff'),
        })}
      </button>

      {loading ? (
        <p>{t('notifications.loading')}</p>
      ) : notifs.length === 0 ? (
        <p style={{ color: '#888' }}>{t('notifications.emptyState')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {notifs.map((n) => (
            <li
              key={n.id}
              style={{
                padding: '8px 0',
                borderTop: '1px solid #eee',
                opacity: n.read ? 0.65 : 1,
              }}
            >
              <div style={{ fontWeight: n.read ? 500 : 700 }}>
                {n.title || t('notifications.defaultTitle')}
              </div>
              <div style={{ fontSize: 13 }}>{n.body || n.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
