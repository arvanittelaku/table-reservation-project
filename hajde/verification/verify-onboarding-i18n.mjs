/**
 * Phase 3 onboarding i18n — TEST 1, 2, 3, 6 with isolated browser contexts.
 * Run: node verification/verify-onboarding-i18n.mjs [baseUrl]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { ensureTestPhotos } from '../test-assets/generate-photos.mjs'
import { normalizeInterests, interestsForMatching } from '../src/lib/tasteInterests.js'
import { matchScore } from '../src/lib/matchScore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const PASS = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'onboarding-i18n', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const INTEREST_CODES = ['muzike', 'sport', 'libra', 'udhetim', 'art', 'teknologji', 'kulinari', 'natyre']

const LABELS = {
  en: { fn: 'First name', ln: 'Last name', em: 'Your email', pw: 'Password', cont: 'Continue', local: "I'm from Kosovo", skipPhoto: /Continue without photo/i, step4: 'Local or visitor?' },
  de: { fn: 'Vorname', ln: 'Nachname', em: 'Deine E-Mail', pw: 'Passwort', cont: 'Weiter', local: 'Ich bin aus dem Kosovo', skipPhoto: /Ohne Foto/i, step4: 'Einheimisch oder Gast?' },
  sq: { fn: 'Emri', ln: 'Mbiemri', em: 'Email-i yt', pw: 'Fjalëkalimi', cont: 'Vazhdo', local: 'Jam nga Kosova', skipPhoto: /pa foto/i, step4: 'Je vendas apo mysafir?' },
  mk: { fn: 'Име', ln: 'Презиме', em: 'Твојот email', pw: 'Лозинка', cont: 'Продолжи', local: 'Јас сум од Косово', skipPhoto: /без фотографија/i, step4: 'Домашен или гостин?' },
}

const WED_OTHER = {
  en: 'Something else',
  de: 'Etwas anderes',
  mk: 'Нешто друго',
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

async function startOnboarding(page) {
  await page.getByRole('button', { name: /Eja bashkohu|Join|Mitmachen|Придружи/i }).first().click()
  await page.locator('.step-title').waitFor({ timeout: 15000 })
}

async function fillStep1(page, locale, email, first = 'Onboard', last = 'Test') {
  const t = LABELS[locale] || LABELS.en
  await page.getByPlaceholder(t.fn).fill(first)
  await page.getByPlaceholder(t.ln).fill(last)
  await page.getByPlaceholder(t.em).fill(email)
  await page.getByPlaceholder(new RegExp(t.pw, 'i')).fill(PASS)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: new RegExp(`^${t.cont}$`, 'i') }).click()
  await page.waitForTimeout(3000)
}

async function passStep2(page, locale) {
  const t = LABELS[locale] || LABELS.en
  await page.locator('.step-title').filter({ hasText: /.+/ }).waitFor()
  await page.getByRole('button', { name: new RegExp(`^${t.cont}$`, 'i') }).click()
  await page.waitForTimeout(800)
}

/** Upload photo: valid file tries Continue; reject file uses skip-without-photo path. */
async function passStep3(page, locale, { photoPath, mode = 'auto' }) {
  const t = LABELS[locale] || LABELS.en
  await page.locator('input[type="file"]').setInputFiles(photoPath)
  await page.waitForTimeout(1800)

  const skipBtn = page.getByRole('button', { name: t.skipPhoto })
  const contBtn = page.getByRole('button', { name: new RegExp(`^${t.cont}$`, 'i') })

  if (mode === 'reject' || (await skipBtn.isVisible().catch(() => false))) {
    await skipBtn.waitFor({ state: 'visible', timeout: 15000 })
    await skipBtn.click()
  } else if (await contBtn.isEnabled().catch(() => false)) {
    await contBtn.click()
  } else {
    // fallback: force skip if validation failed silently
    await skipBtn.waitFor({ state: 'visible', timeout: 5000 })
    await skipBtn.click()
  }

  await page.locator('.step-title').filter({ hasText: t.step4 }).waitFor({ timeout: 15000 })
}

async function passStep4Local(page, locale) {
  const t = LABELS[locale] || LABELS.en
  await page.locator('.step-title').filter({ hasText: t.step4 }).waitFor({ timeout: 15000 })
  // First big choice is always the local-resident option (label uses curly apostrophe in EN)
  await page.locator('.choice-grid .choice.big').first().click()
  await page.waitForTimeout(5000)
}

async function completeTasteQuizDE(page) {
  const sheet = page.locator('.sheet')
  await sheet.locator('.quiz-q').first().waitFor({ timeout: 20000 })
  for (let i = 0; i < 4; i++) {
    await sheet.locator('.ob-choice .choice').first().click()
    await page.waitForTimeout(350)
  }
  await sheet.locator('.ob-choice .choice').filter({ hasText: /^Musik$/i }).click()
  await sheet.locator('.ob-choice .choice').filter({ hasText: /^Sport$/i }).click()
  await sheet.getByRole('button', { name: /^Fertig$/i }).click()
  await page.waitForTimeout(3500)
}

async function queryTasteProfile(page) {
  return page.evaluate(async () => {
    const { sb } = await import('/src/supabaseClient.js')
    const uid = (await sb.auth.getUser()).data.user?.id
    if (!uid) return { uid: null, row: null }
    const { data, error } = await sb.from('taste_profiles').select('*').eq('user_id', uid).maybeSingle()
    return { uid, row: data, error: error?.message || null }
  })
}

async function openWednesdayQuiz(page) {
  const banner = page.locator('.wed-banner').first()
  await banner.waitFor({ state: 'visible', timeout: 20000 })
  await banner.click()
  await page.locator('.sheet .quiz-q').waitFor({ timeout: 10000 })
}

async function screenshotWedOther(page, locale, outPath) {
  const label = WED_OTHER[locale]
  const btn = page.getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
  await btn.waitFor({ state: 'visible', timeout: 10000 })
  await page.screenshot({ path: outPath, fullPage: false })
  return await btn.innerText()
}

;(async () => {
  const report = { base: BASE, ts, outDir: OUT, tests: {} }
  const browser = await chromium.launch({ headless: true })
  const assets = await ensureTestPhotos(browser)
  report.assets = assets

  // Unit tests 4 & 5 (no browser session)
  const legacy = normalizeInterests(['Muzikë', 'Sport'])
  report.tests.test4 = {
    pass: legacy.join(',') === 'muzike,sport',
    legacyIn: ['Muzikë', 'Sport'],
    legacyOut: legacy,
    displayOk: interestsForMatching(['Muzikë']).includes('Muzikë'),
  }
  const profileCodes = { done: true, groupSize: 'mesatare', depth: 'thella', time: 'mbremje', energy: 'mes', interests: ['muzike', 'sport'] }
  const profileLegacy = { ...profileCodes, interests: ['Muzikë', 'Sport'] }
  const scoreCodes = matchScore(profileCodes, { cat: 'muzike', spots: 6 }, {})
  const scoreLegacy = matchScore(profileLegacy, { cat: 'muzike', spots: 6 }, {})
  report.tests.test5 = { pass: scoreCodes === scoreLegacy, scoreCodes, scoreLegacy }

  // ── TEST 1: full EN onboarding, screenshot every step ──
  report.tests.test1 = { pass: false, screenshots: [] }
  {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, 'en')
      await startOnboarding(page)
      await page.screenshot({ path: path.join(OUT, 'test1-en-step1-empty.png') })
      report.tests.test1.screenshots.push('test1-en-step1-empty.png')

      const t = LABELS.en
      await page.getByPlaceholder(t.fn).fill('Onboard')
      await page.getByPlaceholder(t.ln).fill('Test')
      await page.getByPlaceholder(t.em).fill(`ejabashkohu+onb.en.${ts}@gmail.com`)
      await page.getByPlaceholder(new RegExp(t.pw, 'i')).fill(PASS)
      await page.getByRole('checkbox').check()
      await page.screenshot({ path: path.join(OUT, 'test1-en-step1-filled.png') })
      report.tests.test1.screenshots.push('test1-en-step1-filled.png')
      await page.getByRole('button', { name: new RegExp(`^${t.cont}$`, 'i') }).click()
      await page.waitForTimeout(3000)

      await page.locator('.step-title', { hasText: 'How old are you?' }).waitFor()
      await page.screenshot({ path: path.join(OUT, 'test1-en-step2-age.png') })
      report.tests.test1.screenshots.push('test1-en-step2-age.png')
      await passStep2(page, 'en')

      await page.locator('.step-title', { hasText: 'Your profile photo' }).waitFor()
      await page.screenshot({ path: path.join(OUT, 'test1-en-step3-before-photo.png') })
      report.tests.test1.screenshots.push('test1-en-step3-before-photo.png')

      let photoMode = 'valid'
      try {
        await passStep3(page, 'en', { photoPath: assets.photo, mode: 'auto' })
      } catch {
        photoMode = 'skip'
        await passStep3(page, 'en', { photoPath: assets.flat, mode: 'reject' })
      }
      report.tests.test1.photoMode = photoMode
      await page.screenshot({ path: path.join(OUT, 'test1-en-step3-after-photo.png') })
      report.tests.test1.screenshots.push('test1-en-step3-after-photo.png')

      await page.screenshot({ path: path.join(OUT, 'test1-en-step4-local.png') })
      report.tests.test1.screenshots.push('test1-en-step4-local.png')
      await passStep4Local(page, 'en')
      await page.waitForTimeout(2000)
      await page.screenshot({ path: path.join(OUT, 'test1-en-complete-feed.png') })
      report.tests.test1.screenshots.push('test1-en-complete-feed.png')

      const rawKeys = (await page.locator('text=/onboarding\\.|tasteQuiz\\.|wednesdayQuiz\\./').count()) > 0
      const inApp = (await page.locator('.content, .mq-banner, .app-main').first().isVisible().catch(() => false))
      report.tests.test1.pass = !rawKeys && inApp && report.tests.test1.screenshots.length >= 6
    } catch (e) {
      report.tests.test1.error = String(e.message || e)
      await page.screenshot({ path: path.join(OUT, 'test1-en-failure.png') }).catch(() => {})
    } finally {
      await context.close()
    }
  }

  // ── TEST 2: photo validation errors EN + DE (fresh context each) ──
  report.tests.test2 = { pass: false, en: {}, de: {} }
  for (const loc of ['en', 'de']) {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, loc)
      await startOnboarding(page)
      await fillStep1(page, loc, `ejabashkohu+photo.${loc}.${ts}@gmail.com`)
      await passStep2(page, loc)
      await page.locator('input[type="file"]').setInputFiles(assets.flat)
      await page.waitForTimeout(1500)
      await page.locator('.photo-error-block .age-warn').waitFor({ timeout: 15000 })
      const errText = await page.locator('.photo-error-block .age-warn').innerText()
      await page.screenshot({ path: path.join(OUT, `test2-photo-error-${loc}.png`) })
      const pass = loc === 'en'
        ? /too dark|uniform|blank|face|Photo/i.test(errText)
        : /dunkel|einfarbig|Gesicht|Foto|zu hell/i.test(errText)
      report.tests.test2[loc] = { errText, pass, screenshot: `test2-photo-error-${loc}.png` }
    } catch (e) {
      report.tests.test2[loc] = { pass: false, error: String(e.message || e) }
      await page.screenshot({ path: path.join(OUT, `test2-photo-error-${loc}-fail.png`) }).catch(() => {})
    } finally {
      await context.close()
    }
  }
  report.tests.test2.pass = report.tests.test2.en.pass === true && report.tests.test2.de.pass === true

  // ── TEST 3: DE taste quiz → DB stores codes ──
  report.tests.test3 = { pass: false }
  {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, 'de')
      await startOnboarding(page)
      await fillStep1(page, 'de', `ejabashkohu+taste.de.${ts}@gmail.com`)
      await passStep2(page, 'de')
      await passStep3(page, 'de', { photoPath: assets.flat, mode: 'reject' })
      await passStep4Local(page, 'de')
      await completeTasteQuizDE(page)

      const { uid, row, error } = await queryTasteProfile(page)
      const interests = row?.interests || []
      const allCodes = interests.length >= 2 && interests.every((x) => INTEREST_CODES.includes(x))
      const hasExpected = interests.includes('muzike') && interests.includes('sport')
      report.tests.test3 = {
        pass: allCodes && hasExpected,
        userId: uid,
        tasteProfileRow: row,
        dbError: error,
        interests,
        expectedIncludes: ['muzike', 'sport'],
      }
      await page.screenshot({ path: path.join(OUT, 'test3-de-quiz-done.png') })
    } catch (e) {
      report.tests.test3.error = String(e.message || e)
      await page.screenshot({ path: path.join(OUT, 'test3-failure.png') }).catch(() => {})
    } finally {
      await context.close()
    }
  }

  // ── TEST 6: Wednesday "other" in EN, DE, MK ──
  report.tests.test6 = { pass: false, locales: {} }
  {
    const { context, page } = await freshContext(browser)
    try {
      await initLocale(page, 'en')
      await startOnboarding(page)
      await fillStep1(page, 'en', `ejabashkohu+wed.${ts}@gmail.com`)
      await passStep2(page, 'en')
      await passStep3(page, 'en', { photoPath: assets.flat, mode: 'reject' })
      await passStep4Local(page, 'en')

      // Complete taste quiz quickly (English labels)
      const sheet = page.locator('.sheet')
      await sheet.locator('.quiz-q').first().waitFor({ timeout: 20000 })
      for (let i = 0; i < 4; i++) {
        await sheet.locator('.ob-choice .choice').first().click()
        await page.waitForTimeout(300)
      }
      await sheet.locator('.ob-choice .choice').first().click()
      await sheet.getByRole('button', { name: /^Finish$/i }).click()
      await page.waitForTimeout(3000)

      for (const loc of ['en', 'de', 'mk']) {
        await page.evaluate((c) => localStorage.setItem('ejabashkohu-ui-lang', c), loc)
        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForTimeout(2000)
        await openWednesdayQuiz(page)
        const labelText = await screenshotWedOther(page, loc, path.join(OUT, `test6-wed-other-${loc}.png`))
        report.tests.test6.locales[loc] = {
          pass: labelText === WED_OTHER[loc],
          observed: labelText,
          expected: WED_OTHER[loc],
          screenshot: `test6-wed-other-${loc}.png`,
        }
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(500)
      }
      report.tests.test6.pass = ['en', 'de', 'mk'].every((l) => report.tests.test6.locales[l]?.pass === true)
    } catch (e) {
      report.tests.test6.error = String(e.message || e)
      await page.screenshot({ path: path.join(OUT, 'test6-failure.png') }).catch(() => {})
    } finally {
      await context.close()
    }
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()

  const critical = ['test1', 'test2', 'test3', 'test6']
  const failed = critical.some((k) => report.tests[k]?.pass !== true)
  process.exit(failed ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
