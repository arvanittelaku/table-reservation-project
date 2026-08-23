/**
 * Verify Wednesday quiz "other" free-text follow-up.
 * Run: node verification/verify-wed-other-input.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureTestPhotos } from '../test-assets/generate-photos.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const PASS = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'wed-other-input', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const OTHER_LABEL = {
  sq: 'Diçka tjetër',
  en: 'Something else',
  de: 'Etwas anderes',
  mk: 'Нешто друго',
}

const PLACEHOLDER = {
  sq: 'Shkruaj përgjigjen tënde...',
  en: 'Write your answer...',
  de: 'Schreib deine Antwort...',
  mk: 'Напиши го твојот одговор...',
}

async function freshContext(browser) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  return { context, page }
}

async function initLocale(page, code) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate((c) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('ejabashkohu-ui-lang', c)
  }, code)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.lang-switcher button', { hasText: code.toUpperCase() }).first().click()
  await page.waitForTimeout(400)
}

async function signupAndReachFeed(page, locale, email) {
  const labels = {
    en: { fn: 'First name', ln: 'Last name', em: 'Your email', pw: 'Password', cont: 'Continue', step4: 'Local or visitor?' },
    de: { fn: 'Vorname', ln: 'Nachname', em: 'Deine E-Mail', pw: 'Passwort', cont: 'Weiter', step4: 'Einheimisch oder Gast?' },
    sq: { fn: 'Emri', ln: 'Mbiemri', em: 'Email-i yt', pw: 'Fjalëkalimi', cont: 'Vazhdo', step4: 'Je vendas apo mysafir?' },
    mk: { fn: 'Име', ln: 'Презиме', em: 'Твојот email', pw: 'Лозинка', cont: 'Продолжи', step4: 'Домашен или гостин?' },
  }
  const t = labels[locale] || labels.en

  await page.getByRole('button', { name: /Eja bashkohu|Join|Mitmachen|Придружи/i }).first().click()
  await page.getByPlaceholder(t.fn, { exact: true }).fill('WedOther')
  await page.getByPlaceholder(t.ln, { exact: true }).fill('Test')
  await page.getByPlaceholder(t.em, { exact: true }).fill(email)
  await page.getByPlaceholder(new RegExp(t.pw, 'i')).fill(PASS)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: new RegExp(`^${t.cont}$`, 'i') }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: new RegExp(`^${t.cont}$`, 'i') }).click()
  await page.waitForTimeout(800)

  const flat = path.join(__dirname, '..', 'test-assets', 'flat-reject.png')
  await page.locator('input[type="file"]').setInputFiles(flat)
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: /without photo|Ohne Foto|pa foto|без фотографија/i }).click()
  await page.locator('.step-title').filter({ hasText: t.step4 }).waitFor()
  await page.locator('.choice-grid .choice.big').first().click()
  await page.waitForTimeout(4000)

  const sheet = page.locator('.sheet')
  await sheet.locator('.quiz-q').first().waitFor({ timeout: 20000 })
  for (let i = 0; i < 4; i++) {
    await sheet.locator('.ob-choice .choice').first().click()
    await page.waitForTimeout(300)
  }
  await sheet.locator('.ob-choice .choice').first().click()
  const finish = { en: 'Finish', de: 'Fertig', sq: 'Përfundo', mk: 'Заврши' }[locale] || 'Finish'
  await sheet.getByRole('button', { name: new RegExp(`^${finish}$`, 'i') }).click()
  await page.waitForTimeout(2500)
}

async function openWednesdayQuiz(page) {
  await page.locator('.wed-banner').first().waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.wed-banner').first().click()
  await page.locator('.sheet .quiz-q').waitFor({ timeout: 10000 })
}

async function clickOtherOption(page, locale) {
  const label = OTHER_LABEL[locale]
  const sheet = page.locator('.sheet')
  await sheet.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).click()
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  await ensureTestPhotos(browser)
  const report = { base: BASE, ts, outDir: OUT, tests: {} }

  // TEST 1 — other shows input, no auto-advance
  report.tests.test1 = { pass: false }
  {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, 'sq')
      await signupAndReachFeed(page, 'sq', `ejabashkohu+wedother1.${ts}@gmail.com`)
      await openWednesdayQuiz(page)
      const q1Before = await page.locator('.sheet .meta').innerText()
      await clickOtherOption(page, 'sq')
      await page.locator('.wed-other-block input').waitFor({ state: 'visible', timeout: 5000 })
      const q1After = await page.locator('.sheet .meta').innerText()
      await page.screenshot({ path: path.join(OUT, 'test1-sq-other-input.png') })
      report.tests.test1 = {
        pass: q1Before === q1After && q1Before.includes('1'),
        q1Before,
        q1After,
        screenshot: 'test1-sq-other-input.png',
      }
    } catch (e) {
      report.tests.test1.error = String(e.message || e)
    } finally {
      await context.close()
    }
  }

  // TEST 2 — typed answer stored
  report.tests.test2 = { pass: false }
  {
    const { context, page } = await freshContext(browser)
    const custom = 'diçka specifike si p.sh. filma horror'
    try {
      await initLocale(page, 'sq')
      await signupAndReachFeed(page, 'sq', `ejabashkohu+wedother2.${ts}@gmail.com`)
      await openWednesdayQuiz(page)
      await clickOtherOption(page, 'sq')
      await page.locator('.wed-other-block input').fill(custom)
      await page.locator('.wed-other-block .btn.primary').click()
      await page.waitForTimeout(400)

      const sheet = page.locator('.sheet')
      for (let i = 0; i < 3; i++) {
        await sheet.locator('.ob-choice .choice').first().click()
        await page.waitForTimeout(250)
      }
      await page.locator('.lang-grid .lang-chip').first().click()
      await page.locator('.sheet .btn.primary').click()
      await page.waitForTimeout(3500)

      const stored = await page.evaluate(() => window.__lastWedQuizAns)
      report.tests.test2 = {
        pass: stored?.[0] === custom,
        storedAnswer0: stored?.[0],
        expected: custom,
        fullAnswers: stored,
      }
    } catch (e) {
      report.tests.test2.error = String(e.message || e)
    } finally {
      await context.close()
    }
  }

  // TEST 3 — placeholders in all 4 locales
  report.tests.test3 = { pass: false, locales: {} }
  for (const loc of ['sq', 'en', 'de', 'mk']) {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, loc)
      await signupAndReachFeed(page, loc, `ejabashkohu+wedother3.${loc}.${ts}@gmail.com`)
      await openWednesdayQuiz(page)
      await clickOtherOption(page, loc)
      const ph = await page.locator('.wed-other-block input').getAttribute('placeholder')
      await page.screenshot({ path: path.join(OUT, `test3-other-input-${loc}.png`) })
      report.tests.test3.locales[loc] = {
        pass: ph === PLACEHOLDER[loc],
        observed: ph,
        expected: PLACEHOLDER[loc],
        screenshot: `test3-other-input-${loc}.png`,
      }
    } catch (e) {
      report.tests.test3.locales[loc] = { pass: false, error: String(e.message || e) }
    } finally {
      await context.close()
    }
  }
  report.tests.test3.pass = ['sq', 'en', 'de', 'mk'].every((l) => report.tests.test3.locales[l]?.pass === true)

  // TEST 4 — empty submission uses fallback, not blocked
  report.tests.test4 = { pass: false }
  {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, 'sq')
      await signupAndReachFeed(page, 'sq', `ejabashkohu+wedother4.${ts}@gmail.com`)
      await openWednesdayQuiz(page)
      await clickOtherOption(page, 'sq')
      await page.locator('.wed-other-block .btn.primary').click()
      await page.waitForTimeout(400)
      const meta = await page.locator('.sheet .meta').innerText()
      const blocked = !(await page.locator('.wed-other-block').isVisible().catch(() => false))
      report.tests.test4 = {
        pass: blocked && meta.includes('2'),
        advancedToQ2: meta.includes('2'),
        note: 'Empty submit advances with fallback label on final submit',
      }
      await page.screenshot({ path: path.join(OUT, 'test4-empty-other-advanced.png') })

      // finish quiz and verify fallback stored for Q1
      const sheet = page.locator('.sheet')
      for (let i = 0; i < 3; i++) {
        await sheet.locator('.ob-choice .choice').first().click()
        await page.waitForTimeout(200)
      }
      await page.locator('.lang-grid .lang-chip').first().click()
      await page.locator('.sheet .btn.primary').click()
      await page.waitForTimeout(3000)
      const stored = await page.evaluate(() => window.__lastWedQuizAns)
      report.tests.test4.storedAnswer0 = stored?.[0]
      report.tests.test4.fallbackOk = stored?.[0] === OTHER_LABEL.sq
      report.tests.test4.pass = report.tests.test4.pass && report.tests.test4.fallbackOk
    } catch (e) {
      report.tests.test4.error = String(e.message || e)
    } finally {
      await context.close()
    }
  }

  // TEST 5 — normal options auto-advance
  report.tests.test5 = { pass: false }
  {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, 'en')
      await signupAndReachFeed(page, 'en', `ejabashkohu+wedother5.${ts}@gmail.com`)
      await openWednesdayQuiz(page)
      await page.locator('.sheet .ob-choice .choice').first().click()
      await page.waitForTimeout(400)
      const meta = await page.locator('.sheet .meta').innerText()
      const noOtherInput = !(await page.locator('.wed-other-block').isVisible().catch(() => false))
      report.tests.test5 = {
        pass: meta.includes('2') && noOtherInput,
        metaAfterFirstClick: meta,
        screenshot: 'test5-normal-advance.png',
      }
      await page.screenshot({ path: path.join(OUT, 'test5-normal-advance.png') })
    } catch (e) {
      report.tests.test5.error = String(e.message || e)
    } finally {
      await context.close()
    }
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
  const failed = Object.values(report.tests).some((t) => t.pass !== true)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
