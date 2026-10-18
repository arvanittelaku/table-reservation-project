import { useI18n } from '../i18n/I18nContext'
import LanguageSwitcher from './LanguageSwitcher'

const STEP_KEYS = ['s1', 's2', 's3', 's4']
const CAT_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']
const TRUST_KEYS = ['t1', 't2', 't3', 't4']
const FAQ_KEYS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']

export default function LandingPage({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) {
  const { t } = useI18n()

  return (
    <main className="landing">

      {/* Hero */}
      <section className="landing-hero">
        <nav className="landing-nav">
          <span className="logo-word">
            eja<span className="logo-bang">Bashkohu</span>
          </span>
          <div className="landing-nav-actions">
            <LanguageSwitcher className="on-dark" />
            <button type="button" className="btn ghost sm" onClick={onSignIn}>
              {t('nav.signIn')}
            </button>
          </div>
        </nav>

        <div className="landing-hero-content">
          <div className="landing-hero-text">
            <div className="landing-live-strip">
              <span className="landing-live-dot" />
              {t('landing.liveBadge')}
            </div>
            <h1 className="landing-h1">
              {t('landing.heroTitleBefore')}
              <br />
              {t('landing.heroTitleMid') ? `${t('landing.heroTitleMid')} ` : ''}
              <em>{t('landing.heroTitleEmphasis')}</em>
              {t('landing.heroTitleAfter') ? ` ${t('landing.heroTitleAfter')}` : ''}
            </h1>
            <p className="landing-sub">{t('landing.heroSubtitle')}</p>
            <div className="landing-hero-actions">
              <button type="button" className="btn hero-cta" onClick={onGetStarted}>
                {t('nav.joinCtaFree')}
              </button>
              <a href="#si-funksionon" className="landing-hero-link">
                {t('landing.heroHow')}
              </a>
            </div>
            <p className="landing-fee">{t('landing.heroFee')}</p>
          </div>

          <div className="landing-hero-cards" aria-hidden="true">
            <div className="lp-card lp-card-main">
              <span className="lp-card-label lp-cyan">{t('landing.heroCards.mainLabel')}</span>
              <strong className="lp-card-title">{t('landing.heroCards.mainTitle')}</strong>
              <div className="lp-spots">
                <span className="lp-spot lp-spot-1" />
                <span className="lp-spot lp-spot-2" />
                <span className="lp-spot lp-spot-3" />
                <span className="lp-spot lp-spot-empty" />
                <span className="lp-spot-count">4/6</span>
              </div>
              <span className="lp-card-sub">{t('landing.heroCards.mainHost')}</span>
            </div>
            <div className="lp-card lp-card-sport">
              <span className="lp-card-label lp-gold">{t('landing.heroCards.sportLabel')}</span>
              <strong className="lp-card-title lp-card-title-sm">{t('landing.heroCards.sportTitle')}</strong>
              <span className="lp-card-sub">{t('landing.heroCards.sportSeats')}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-how" id="si-funksionon">
        <h2>{t('landing.howTitle')}</h2>
        <div className="landing-steps">
          {STEP_KEYS.map((key, i) => (
            <div key={key} className="landing-step">
              <div className="step-num">{i + 1}</div>
              <h3>{t(`landing.steps.${key}.title`)}</h3>
              <p>{t(`landing.steps.${key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cats" id="aktivitetet">
        <h2>{t('landing.catsTitle')}</h2>
        <p className="landing-cats-sub">{t('landing.catsSub')}</p>
        <div className="landing-cat-grid">
          {CAT_KEYS.map((key) => (
            <div key={key} className="landing-cat-card">
              <h3>{t(`landing.categories.${key}.title`)}</h3>
              <p>{t(`landing.categories.${key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-trust" id="siguria">
        <h2>{t('landing.trustTitle')}</h2>
        <div className="landing-trust-grid">
          {TRUST_KEYS.map((key, i) => (
            <div key={key} className="trust-item">
              <div className="trust-icon">{['!', '18', 'OK', 'P'][i]}</div>
              <h3>{t(`landing.trust.${key}.title`)}</h3>
              <p>{t(`landing.trust.${key}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-cities" id="qytetet">
        <h2>{t('landing.citiesTitle')}</h2>
        <p>{t('landing.citiesP1')}</p>
        <p>{t('landing.citiesP2')}</p>
        <button type="button" className="btn hero-cta" onClick={onGetStarted}>
          {t('nav.viewTablesToday')}
        </button>
      </section>

      <section className="landing-faq" id="pyetje">
        <h2>{t('landing.faqTitle')}</h2>
        <div className="faq-list">
          {FAQ_KEYS.map((key) => (
            <details key={key} className="faq-item">
              <summary className="faq-q">{t(`landing.faq.${key}.q`)}</summary>
              <p className="faq-a">{t(`landing.faq.${key}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-final-cta">
        <h2>{t('landing.finalTitle')}</h2>
        <p>{t('landing.finalSub')}</p>
        <button type="button" className="btn hero-cta lg" onClick={onGetStarted}>
          {t('nav.joinCtaNow')}
        </button>
      </section>

      <footer className="landing-footer">
        <div className="footer-brand">
          <span className="logo-word">
            eja<span className="logo-bang">Bashkohu</span>
          </span>
          <p>{t('landing.footerTagline')}</p>
        </div>
        <div className="footer-links">
          <button
            type="button"
            className="footer-link"
            onClick={() => window.dispatchEvent(new CustomEvent('showPolicy', { detail: 'privacy' }))}
          >
            {t('landing.footerPrivacy')}
          </button>
          <button
            type="button"
            className="footer-link"
            onClick={() => window.dispatchEvent(new CustomEvent('showPolicy', { detail: 'terms' }))}
          >
            {t('landing.footerTerms')}
          </button>
          <a href="mailto:hello@ejabashkohu.app" className="footer-link">
            {t('landing.footerContact')}
          </a>
        </div>
        <p className="footer-copy">{t('landing.footerCopy')}</p>
      </footer>

    </main>
  )
}
