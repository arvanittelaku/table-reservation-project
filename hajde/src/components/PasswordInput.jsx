import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.03-.03c1.39-1.39 2.16-3.24 2.16-5.19 0-.65-.13-1.26-.36-1.83l-1.42 1.42c.05.2.08.41.08.63 0 1.32-1.07 2.39-2.39 2.39-.22 0-.43-.03-.63-.08z" />
    </svg>
  )
}

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  className = 'input modern',
  wrapperClassName = 'input-password-wrap',
  ...props
}) {
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  const inputClass = visible ? className : `${className} password-masked`.trim()

  return (
    <div className={wrapperClassName}>
      <input
        className={inputClass}
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...props}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('passwordInput.hide') : t('passwordInput.show')}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}
