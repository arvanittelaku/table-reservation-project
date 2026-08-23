import { useI18n } from '../i18n/I18nContext.jsx'

export default function PrivacyPolicy({ onBack }) {
  const { t } = useI18n()

  return (
    <div className="policy-page">
      <button className="btn ghost policy-back" onClick={onBack}>
        {t('privacyPolicy.back')}
      </button>

      <h1>{t('privacyPolicy.title')}</h1>
      <p className="policy-date">{t('privacyPolicy.effectiveDate')}</p>

      <section>
        <h2>{t('privacyPolicy.section1Title')}</h2>
        <p>{t('privacyPolicy.section1Body1')}</p>
        <p>{t('privacyPolicy.section1Body2')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section2Title')}</h2>
        <ul>
          {t('privacyPolicy.section2Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('privacyPolicy.section3Title')}</h2>
        <ul>
          {t('privacyPolicy.section3Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{t('privacyPolicy.section3Body')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section4Title')}</h2>
        <p>{t('privacyPolicy.section4Body1')}</p>
        <p>{t('privacyPolicy.section4Body2')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section5Title')}</h2>
        <p>{t('privacyPolicy.section5Body')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section6Title')}</h2>
        <ul>
          {t('privacyPolicy.section6Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{t('privacyPolicy.section6Body')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section7Title')}</h2>
        <ul>
          {t('privacyPolicy.section7Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('privacyPolicy.section8Title')}</h2>
        <p>{t('privacyPolicy.section8Body')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section9Title')}</h2>
        <p>{t('privacyPolicy.section9Body')}</p>
      </section>

      <section>
        <h2>{t('privacyPolicy.section10Title')}</h2>
        <p>{t('privacyPolicy.section10Body')}</p>
      </section>
    </div>
  )
}
