import { useI18n } from '../i18n/I18nContext.jsx'

export default function TermsOfService({ onBack }) {
  const { t } = useI18n()

  return (
    <div className="policy-page">
      <button className="btn ghost policy-back" onClick={onBack}>
        {t('termsOfService.back')}
      </button>

      <h1>{t('termsOfService.title')}</h1>
      <p className="policy-date">{t('termsOfService.effectiveDate')}</p>

      <section>
        <h2>{t('termsOfService.section1Title')}</h2>
        <p>{t('termsOfService.section1Body')}</p>
      </section>

      <section>
        <h2>{t('termsOfService.section2Title')}</h2>
        <ul>
          {t('termsOfService.section2Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('termsOfService.section3Title')}</h2>
        <p>{t('termsOfService.section3Body1')}</p>
        <p>{t('termsOfService.section3Body2')}</p>
        <p>{t('termsOfService.section3Body3')}</p>
      </section>

      <section>
        <h2>{t('termsOfService.section4Title')}</h2>
        <p>{t('termsOfService.section4Intro')}</p>
        <ul>
          {t('termsOfService.section4Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t('termsOfService.section5Title')}</h2>
        <p>{t('termsOfService.section5Body1')}</p>
        <p>{t('termsOfService.section5Body2')}</p>
      </section>

      <section>
        <h2>{t('termsOfService.section6Title')}</h2>
        <p>{t('termsOfService.section6Body')}</p>
      </section>

      <section>
        <h2>{t('termsOfService.section7Title')}</h2>
        <p>{t('termsOfService.section7Intro')}</p>
        <ul>
          {t('termsOfService.section7Items').map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{t('termsOfService.section7Body')}</p>
      </section>

      <section>
        <h2>{t('termsOfService.section8Title')}</h2>
        <p>{t('termsOfService.section8Body')}</p>
      </section>

      <section>
        <h2>{t('termsOfService.section9Title')}</h2>
        <p>{t('termsOfService.section9Body')}</p>
      </section>
    </div>
  )
}
