import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nContext.jsx'
import { sb } from '../../backendClient'
import { uploadAvatar, saveAvatarToProfile, deleteAvatar, clearAvatarCache } from '../../api/storage'
import { getEmailNotificationsEnabled, setEmailNotificationsEnabled } from '../../api/notifications'
import { invalidateOwnProfile } from '../../lib/ownProfile'
import { photoErrorKey } from '../../lib/faceValidation'

const env = import.meta.env || {}
/** Store / social links (override with VITE_* at build time). */
export const APP_LINKS = {
  rateIos: env.VITE_APP_STORE_URL || 'https://apps.apple.com/app/ejabashkohu',
  rateAndroid: env.VITE_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.ejabashkohu.app',
  instagram: env.VITE_INSTAGRAM_URL || 'https://www.instagram.com/ejabashkohu',
  facebook: env.VITE_FACEBOOK_URL || 'https://www.facebook.com/ejabashkohu',
  tiktok: env.VITE_TIKTOK_URL || 'https://www.tiktok.com/@ejabashkohu',
}
export function rateAppUrl() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  return /iPhone|iPad|iPod|Macintosh/.test(ua) ? APP_LINKS.rateIos : APP_LINKS.rateAndroid
}

/**
 * "Edit profile" sheet: photo (replace / remove), name, age, languages,
 * tourist + home place, email notifications, taste profile, home city,
 * rate / follow the app.
 */
export function EditProfile({ profile, photo, languages, validatePhoto, compressPhoto, onClose, onSaved,
  onEditTaste, onChangeCity, homeCity, showChangeCity, showToast }) {
  const { t } = useI18n()
  const fileRef = useRef(null)
  const [form, setForm] = useState(() => ({
    first: profile?.first_name === 'Përdorues' ? '' : profile?.first_name || '',
    last: profile?.last_name || '',
    age: String(profile?.age ?? ''),
    langs: Array.isArray(profile?.langs) && profile.langs.length ? profile.langs : ['Shqip'],
    tourist: !!profile?.is_tourist,
    from: profile?.from_place || '',
  }))
  const [preview, setPreview] = useState(photo || null)
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState(null)
  const [emailOn, setEmailOn] = useState(true)
  useEffect(() => { getEmailNotificationsEnabled().then(setEmailOn).catch(() => {}) }, [])
  useEffect(() => { setPreview(photo || null) }, [photo])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const toggleLang = (label) => set('langs', form.langs.includes(label)
    ? form.langs.filter((l) => l !== label) : [...form.langs, label])

  const onPick = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const reader = new FileReader()
    reader.onload = async () => {
      setPhotoBusy(true); setError(null)
      try {
        const v = await validatePhoto(reader.result)
        if (!v.ok) { setError(t(photoErrorKey(v.code))); return }
        const dataUrl = await compressPhoto(reader.result)
        const blob = await (await fetch(dataUrl)).blob()
        const path = await uploadAvatar(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }), profile?.id)
        await saveAvatarToProfile(path, profile?.id)
        clearAvatarCache(path)
        setPreview(dataUrl)
        showToast?.(t('editProfile.photoSaved'))
        await onSaved?.()
      } catch {
        setError(t('toasts.photoUploadFailed'))
      } finally { setPhotoBusy(false) }
    }
    reader.readAsDataURL(f)
  }

  const removePhoto = async () => {
    if (!window.confirm(t('editProfile.removePhotoConfirm'))) return
    setPhotoBusy(true)
    try {
      await deleteAvatar()
      invalidateOwnProfile()
      setPreview(null)
      showToast?.(t('editProfile.photoRemoved'))
      await onSaved?.()
    } catch { setError(t('editProfile.saveFailed')) } finally { setPhotoBusy(false) }
  }

  const save = async () => {
    const age = parseInt(form.age, 10)
    if (!form.first.trim() || !form.last.trim()) return setError(t('social.errors.nameRequired'))
    if (!(age >= 18 && age <= 99)) return setError(t('editProfile.ageInvalid'))
    if (form.first.trim().length > 40 || form.last.trim().length > 40) return setError(t('editProfile.nameTooLong'))
    setBusy(true); setError(null)
    try {
      const { error: e } = await sb.from('profiles').update({
        first_name: form.first.trim(), last_name: form.last.trim(), age,
        langs: form.langs.length ? form.langs : ['Shqip'],
        is_tourist: form.tourist, from_place: form.tourist ? (form.from.trim() || null) : null,
      }).eq('id', profile.id)
      if (e) throw e
      // the header reads the name/age from the account metadata
      await sb.auth.updateUser({ data: { first_name: form.first.trim(), last_name: form.last.trim(), age } })
      invalidateOwnProfile()
      await onSaved?.()
      showToast?.(t('editProfile.saved'))
      onClose()
    } catch {
      setError(t('editProfile.saveFailed'))
    } finally { setBusy(false) }
  }

  const toggleEmail = async () => {
    const next = !emailOn
    setEmailOn(next)
    try { await setEmailNotificationsEnabled(next) } catch { setEmailOn(!next); setError(t('editProfile.saveFailed')) }
  }

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet edit-profile" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hdr">
          <button className="icon-btn" onClick={onClose} aria-label={t('profile.close')}>×</button>
          <div><h2>{t('editProfile.title')}</h2></div>
        </div>

        <div className="ep-photo">
          {preview
            ? <img src={preview} alt="" className="ep-avatar" />
            : <div className="ep-avatar initial">{(form.first || '?')[0]?.toUpperCase()}</div>}
          <div className="ep-photo-actions">
            <button type="button" className="btn ghost sm" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? t('editProfile.uploading') : preview ? t('editProfile.changePhoto') : t('editProfile.addPhoto')}
            </button>
            {preview && (
              <button type="button" className="btn ghost sm ep-remove" disabled={photoBusy} onClick={removePhoto}>
                {t('editProfile.removePhoto')}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />
        </div>

        <label className="label" htmlFor="ep-first">{t('editProfile.firstName')}</label>
        <input id="ep-first" className="input modern" maxLength={40} value={form.first} onChange={(e) => set('first', e.target.value)} />
        <label className="label" htmlFor="ep-last">{t('editProfile.lastName')}</label>
        <input id="ep-last" className="input modern" maxLength={40} value={form.last} onChange={(e) => set('last', e.target.value)} />
        <label className="label" htmlFor="ep-age">{t('editProfile.age')}</label>
        <input id="ep-age" className="input modern" type="number" min={18} max={99} inputMode="numeric" value={form.age} onChange={(e) => set('age', e.target.value)} />

        <p className="label">{t('editProfile.languages')}</p>
        <div className="ob-choice ep-langs">
          {languages.map((l) => (
            <button key={l.v} type="button" className={`choice ${form.langs.includes(l.label) ? 'on' : ''}`} onClick={() => toggleLang(l.label)}>{l.label}</button>
          ))}
        </div>

        <p className="label">{t('editProfile.whereFrom')}</p>
        <div className="pay-methods">
          <button type="button" className={`method ${!form.tourist ? 'on' : ''}`} onClick={() => set('tourist', false)}>{t('editProfile.local')}</button>
          <button type="button" className={`method ${form.tourist ? 'on' : ''}`} onClick={() => set('tourist', true)}>{t('editProfile.tourist')}</button>
        </div>
        {form.tourist && (
          <input className="input modern ep-from" maxLength={60} placeholder={t('editProfile.fromPlaceholder')} value={form.from} onChange={(e) => set('from', e.target.value)} />
        )}

        {error && <p className="age-warn" role="alert">{error}</p>}
        <button type="button" className="btn primary full ep-save" disabled={busy} onClick={save}>
          {busy ? t('editProfile.saving') : t('editProfile.save')}
        </button>

        <div className="ep-list">
          <label className="toggle-row ep-email">
            <input type="checkbox" checked={emailOn} onChange={toggleEmail} />
            <span>{t('editProfile.emailNotifications')}</span>
          </label>
          <button type="button" className="btn ghost full ep-taste" onClick={onEditTaste}>{t('editProfile.editTaste')}</button>
          {showChangeCity && (
            <button type="button" className="btn ghost full ep-city" onClick={onChangeCity}>
              {t('editProfile.homeCity', { city: homeCity || '-' })}
            </button>
          )}
          <a className="btn ghost full ep-rate" href={rateAppUrl()} target="_blank" rel="noopener noreferrer">★ {t('editProfile.rateApp')}</a>
          <p className="label ep-follow-title">{t('editProfile.followApp')}</p>
          <div className="ep-social">
            <a className="ep-soc instagram" href={APP_LINKS.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>
            <a className="ep-soc facebook" href={APP_LINKS.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
            <a className="ep-soc tiktok" href={APP_LINKS.tiktok} target="_blank" rel="noopener noreferrer">TikTok</a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditProfile
