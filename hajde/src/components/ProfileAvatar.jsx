import { useAvatar } from '../hooks/useAvatar'

const SHIELD_NOTE = 'Fotoja e çdo profili kalon kontrollin e fytyrës'

/**
 * Profile modal avatar: signed URL from Storage, or initial placeholder.
 * Drop into the person pop-up — does not change surrounding layout styles beyond
 * a minimal inline structure the host UI can wrap.
 */
export function ProfileAvatar({ profile, size = 72, className = '' }) {
  const path = profile?.photo_path ?? null
  const { url, loading, showPlaceholder } = useAvatar(path)
  const initial = (profile?.first_name || profile?.firstName || '?').charAt(0).toUpperCase()

  return (
    <div className={className} style={{ textAlign: 'center' }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          margin: '0 auto',
          background: '#e8e4dc',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          fontSize: size * 0.4,
          color: '#3d3a34',
        }}
        aria-hidden={!!url}
      >
        {loading ? (
          <span style={{ fontSize: 12 }}>…</span>
        ) : url ? (
          <img
            src={url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          showPlaceholder && <span>{initial}</span>
        )}
      </div>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 11,
          lineHeight: 1.35,
          color: '#6b6560',
          maxWidth: 200,
          marginInline: 'auto',
        }}
      >
        {SHIELD_NOTE}
      </p>
    </div>
  )
}

export { SHIELD_NOTE }
