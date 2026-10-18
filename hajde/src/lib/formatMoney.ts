import { detectLocale } from '../i18n/index'

/* Money the way each language writes it: 2,00 € (Albanian, German, Macedonian) and €2.00 (English). */
const INTL_LOCALE = { sq: 'sq-AL', en: 'en-GB', de: 'de-DE', mk: 'mk-MK' } as const

/** "€2.00" / "2,00 €"; `whole` drops the cents of round amounts ("€2"). */
export function formatEuro(amount: number, opts: { whole?: boolean } = {}): string {
  const n = Number(amount) || 0
  const digits = opts.whole && Number.isInteger(n) ? 0 : 2
  return new Intl.NumberFormat(INTL_LOCALE[detectLocale()], {
    style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: 2,
  }).format(n)
}

/** Only the number ("2.00" / "2,00"), for texts that carry their own € sign. */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(INTL_LOCALE[detectLocale()], {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(amount) || 0)
}
