/**
 * Evidence-based verification — run:
 *   npx playwright install chromium
 *   node verification/run-verification.mjs http://127.0.0.1:5173
 *   node verification/run-verification.mjs https://ejabashkohu.com
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '')
const OUT = path.join(__dirname, 'evidence', BASE.includes('ejabashkohu.com') ? 'production' : 'local')
const ts = Date.now()
const PASSWORD = 'testpass123'
const EMAIL_A = `ejabashkohu+leaktest1.${ts}@gmail.com`
const EMAIL_B = `ejabashkohu+leaktest2.${ts}@gmail.com`
const EMAIL_C = `ejabashkohu+leaktest3.${ts}@gmail.com`
const PHOTO_A = path.resolve(__dirname, '..', 'test-assets', 'photo-a.jpg')
const PHOTO_B = path.resolve(__dirname, '..', 'test-assets', 'photo-b.jpg')

fs.mkdirSync(OUT, { recursive: true })

const report = { base: BASE, ts, emails: { EMAIL_A, EMAIL_B, EMAIL_C }, tests: {} }

function log(msg) {
  process.stderr.write(msg + '\n')
}

function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2))
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: p })
  return p
}

function attachDialogAutoAccept(page) {
  page.on('dialog', (d) => {
    report.dialogs = report.dialogs || []
    report.dialogs.push({ type: d.type(), message: d.message() })
    d.accept()
  })
}

async function dismissQuizIfOpen(page) {
  const later = page.getByRole('button', { name: 'Më vonë' })
  if (await later.isVisible().catch(() => false)) await later.click()
}

async function setAge(page, target) {
  const ageBig = page.locator('.age-big')
  await ageBig.waitFor({ timeout: 10000 })
  let current = parseInt(await ageBig.textContent(), 10) || 24
  const dec = page.getByRole('button', { name: 'Zvogëlo' })
  const inc = page.getByRole('button', { name: 'Rrit' })
  while (current > target) {
    await dec.click()
    current = parseInt(await ageBig.textContent(), 10)
  }
  while (current < target) {
    await inc.click()
    current = parseInt(await ageBig.textContent(), 10)
  }
  return current
}

async function onboard(page, { firstName, lastName, email, age, photoPath, skipPhoto }) {
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill(firstName)
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill(lastName)
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  const finalAge = await setAge(page, age)
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  if (!skipPhoto && photoPath) {
    await page.locator('input[type="file"]').setInputFiles(photoPath)
    await page.waitForTimeout(2000)
    const skip = page.getByRole('button', { name: /Vazhdo pa foto/i })
    if (await skip.isVisible().catch(() => false)) await skip.click()
    else await page.locator('.step-body').getByRole('button', { name: 'Vazhdo' }).click()
  } else {
    // skip photo entirely via skip button if photo validation fails
    await page.locator('input[type="file"]').setInputFiles(photoPath || PHOTO_A)
    await page.waitForTimeout(1500)
    const skip = page.getByRole('button', { name: /Vazhdo pa foto/i })
    if (await skip.isVisible().catch(() => false)) await skip.click()
  }
  const profilesWait = page.waitForResponse(
    (r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'GET',
    { timeout: 30000 },
  ).catch(() => null)
  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  const profResp = await profilesWait
  let profilesJson = null
  if (profResp) {
    try { profilesJson = await profResp.json() } catch { profilesJson = await profResp.text() }
  }
  await page.waitForTimeout(3000)
  await dismissQuizIfOpen(page)
  return { finalAge, profilesJson, profilesStatus: profResp?.status?.() }
}

async function readHeaderDom(page) {
  return page.evaluate(() => {
    const span = document.querySelector('.hdr-user span')
    const img = document.querySelector('.hdr-user img')
    return {
      headerSpanText: span?.textContent?.trim() ?? null,
      headerAvatarSrc: img?.src ?? null,
      pageTextHasProvaA: document.body.innerText.includes('ProvaA'),
      pageTextHasProvaB: document.body.innerText.includes('ProvaB'),
      pageTextHas19: /\b19\b/.test(document.body.innerText),
      pageTextHas35: /\b35\b/.test(document.body.innerText),
    }
  })
}

async function openProfileModal(page) {
  await page.locator('.hdr-user').click({ force: true })
  await page.waitForTimeout(700)
  return page.evaluate(() => {
    const sheet = document.querySelector('.sheet-wrap.centerv .sheet, .centerv .sheet')
    const h2 = sheet?.querySelector('h2')?.textContent?.trim()
    const img = sheet?.querySelector('img')
    return {
      modalH2: h2,
      modalImgSrc: img?.src ?? null,
      modalText: sheet?.innerText ?? null,
    }
  })
}

async function closeProfileModal(page) {
  await page.locator('.sheet-wrap.centerv .icon-btn, .modal-x').first().click().catch(() => {})
  await page.waitForTimeout(300)
}

async function signOut(page) {
  await page.locator('.hdr-user').click({ force: true })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Dil nga llogaria' }).click()
  await page.waitForTimeout(2500)
}

async function openQuiz(page) {
  const start = page.getByText('Fillo →')
  if (await start.isVisible().catch(() => false)) await start.click()
  else await page.locator('.mq-banner').click().catch(() => {})
  await page.waitForTimeout(800)
  return page.locator('h2:has-text("Profili i shijeve")').isVisible()
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const pageB = await ctxB.newPage()
  attachDialogAutoAccept(pageB)
  const logsB = []
  pageB.on('console', (m) => logsB.push(m.text()))

  try {
    // ─── TEST 1 ───
    log('TEST 1: Register ProvaA...')
    const regA = await onboard(pageB, {
      firstName: 'ProvaA', lastName: 'Leak', email: EMAIL_A, age: 19, photoPath: PHOTO_A,
    })
    const t1 = { regA }
    t1.headerA = await readHeaderDom(pageB)
    t1.headerA.consoleProbe = await pageB.evaluate(() =>
      JSON.stringify({ name: document.querySelector('.hdr-user span')?.textContent }),
    )
    t1.headerAScreenshot = await shot(pageB, 't1-header-provaA')
    t1.modalA = await openProfileModal(pageB)
    t1.modalAScreenshot = await shot(pageB, 't1-modal-provaA')
    await closeProfileModal(pageB)

    log('TEST 1: Sign out ProvaA...')
    await signOut(pageB)
    t1.afterSignOut = await pageB.evaluate(() => ({
      url: location.href,
      hasLandingCta: !!Array.from(document.querySelectorAll('button')).find((b) => /Eja bashkohu/i.test(b.textContent || '')),
      hasFeedHeader: !!document.querySelector('.hdr-user'),
      bodyStart: document.body.innerText.slice(0, 400),
    }))
    t1.afterSignOutScreenshot = await shot(pageB, 't1-after-signout')

    log('TEST 1: Register ProvaB...')
    const regB = await onboard(pageB, {
      firstName: 'ProvaB', lastName: 'Clean', email: EMAIL_B, age: 35, photoPath: PHOTO_B,
    })
    t1.regB = regB
    t1.headerB = await readHeaderDom(pageB)
    t1.headerBScreenshot = await shot(pageB, 't1-header-provaB-immediate')
    t1.modalB = await openProfileModal(pageB)
    t1.modalBScreenshot = await shot(pageB, 't1-modal-provaB')
    t1.profilesNetworkBody = regB.profilesJson

    t1.pass =
      t1.headerB.headerSpanText?.includes('ProvaB') &&
      t1.headerB.headerSpanText?.includes('35') &&
      !t1.headerB.headerSpanText?.includes('ProvaA') &&
      !t1.headerB.headerSpanText?.includes('Leak') &&
      !t1.headerB.pageTextHasProvaA &&
      !t1.modalB.modalText?.includes('ProvaA') &&
      (regB.profilesJson?.first_name === 'ProvaB' || regB.profilesJson?.[0]?.first_name === 'ProvaB')

    report.tests.test1 = t1

    // ─── TEST 3 ───
    log('TEST 3: Quiz navigation...')
    const t3 = {}
    await closeProfileModal(pageB).catch(() => {})
    const quizOpen = await openQuiz(pageB)
    t3.quizOpen = quizOpen
    if (quizOpen) {
      t3.quizMeta = await pageB.locator('.sheet-hdr .meta').textContent()
      t3.dotCount = await pageB.locator('.quiz-dot').count()
      await pageB.locator('.ob-choice .choice').first().click()
      await pageB.waitForTimeout(400)
      t3.metaAfterQ1 = await pageB.locator('.sheet-hdr .meta').textContent()
      // answer Q2-Q4
      for (let i = 0; i < 3; i++) {
        await pageB.locator('.ob-choice .choice').first().click()
        await pageB.waitForTimeout(250)
      }
      await pageB.locator('.quiz-dot').nth(1).click()
      t3.q2DotScreenshot = await shot(pageB, 't3-q2-revisit')
      t3.q2SelectedCount = await pageB.locator('.ob-choice .choice.on').count()
      await pageB.locator('.ob-choice .choice').nth(1).click()
      const lastDot = t3.dotCount - 1
      await pageB.locator('.quiz-dot').nth(lastDot).click()
      await pageB.locator('.quiz-dot').nth(2).click()
      t3.q3DotAnswered = await pageB.locator('.quiz-dot').nth(2).evaluate((el) => el.classList.contains('answered'))
      await pageB.locator('.quiz-dot').nth(3).click()
      t3.q4DotAnswered = await pageB.locator('.quiz-dot').nth(3).evaluate((el) => el.classList.contains('answered'))
      t3.skipVisible = await pageB.getByRole('button', { name: 'Kalo këtë pyetje' }).isVisible()
      // finish quiz
      await pageB.locator('.quiz-dot').nth(lastDot).click()
      await pageB.locator('.ob-choice .choice').first().click()
      const finish = pageB.getByRole('button', { name: 'Përfundo' })
      if (await finish.isVisible().catch(() => false)) await finish.click()
      else await pageB.getByRole('button', { name: 'Kalo këtë pyetje' }).click()
      await pageB.waitForTimeout(2000)
      t3.pass = t3.dotCount === 5 && /nga 5/.test(t3.quizMeta || '') && t3.q3DotAnswered && t3.q4DotAnswered && t3.skipVisible
    }
    report.tests.test3 = t3

    // ─── TEST 4 ───
    log('TEST 4: Language chips...')
    const t4 = {}
    await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
    await pageB.waitForTimeout(700)
    t4.chipCount = await pageB.locator('.lang-chip').count()
    t4.chipLabels = await pageB.locator('.lang-chip').allTextContents()
    t4.screenshot = await shot(pageB, 't4-lang-chips')
    await pageB.locator('.lang-chip').filter({ hasText: 'Deutsch' }).click()
    await pageB.locator('.lang-chip').filter({ hasText: 'English' }).click()
    await pageB.locator('.lang-chip').filter({ hasText: 'Français' }).click()
    await pageB.locator('#f-cafe').fill('Lang Test Café')
    await pageB.locator('#f-time').fill('Sot, 22:00')
    await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
    await pageB.waitForTimeout(3500)
    // open newest card
    await pageB.locator('.card').filter({ hasText: 'Lang Test Café' }).first().click().catch(async () => {
      await pageB.getByText('Lang Test Café').first().click()
    })
    await pageB.waitForTimeout(800)
    t4.detailLangText = await pageB.locator('.langs').first().textContent().catch(() => null)
    t4.pass = t4.chipCount >= 8 && /Deutsch/.test(t4.detailLangText || '') && !/\bde\b/i.test(t4.detailLangText || '')
    report.tests.test4 = t4

    // ─── TEST 5 ───
    log('TEST 5: Share plan...')
    const t5 = {}
    await pageB.evaluate(() => {
      window.__copied = null
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard)
      navigator.clipboard.writeText = async (t) => { window.__copied = t; return orig(t) }
    })
    const shareBtn = pageB.getByRole('button', { name: /Ndaje planin/i })
    if (await shareBtn.isVisible().catch(() => false)) {
      await shareBtn.click()
      await pageB.waitForTimeout(600)
      t5.clipboard = await pageB.evaluate(() => window.__copied)
    }
    // no-area table
    await pageB.keyboard.press('Escape').catch(() => {})
    await pageB.locator('.sheet-wrap').click({ position: { x: 2, y: 2 } }).catch(() => {})
    await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
    await pageB.locator('#f-cafe').fill('No Area Café')
    await pageB.locator('#f-area').fill('')
    await pageB.locator('#f-time').fill('Sot, 23:00')
    await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
    await pageB.waitForTimeout(3000)
    await pageB.getByText('No Area Café').first().click()
    await pageB.waitForTimeout(600)
    await pageB.evaluate(() => { window.__copied2 = null })
    const share2 = pageB.getByRole('button', { name: /Ndaje planin/i })
    if (await share2.isVisible().catch(() => false)) {
      await share2.click()
      await pageB.waitForTimeout(400)
      t5.clipboardNoArea = await pageB.evaluate(() => window.__copied2 || window.__copied)
    }
    t5.pass = !!t5.clipboard && !t5.clipboard.includes('(,') && (t5.clipboardNoArea ? !t5.clipboardNoArea.includes('(,') : true)
    report.tests.test5 = t5

    // ─── TEST 2 ───
    log('TEST 2: Realtime chat two contexts...')
    const t2 = {}
    const ctxC = await browser.newContext()
    const pageC = await ctxC.newPage()
    attachDialogAutoAccept(pageC)
    const logsBChat = []
    const logsCChat = []
    pageB.on('console', (m) => logsBChat.push(m.text()))
    pageC.on('console', (m) => logsCChat.push(m.text()))

    // ProvaB creates realtime table
    await pageB.goto(BASE + '/')
    await pageB.waitForTimeout(2000)
    await dismissQuizIfOpen(pageB)
    await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
    await pageB.locator('#f-cafe').fill('Realtime Test Café')
    await pageB.locator('#f-area').fill('Dardania')
    await pageB.locator('#f-time').fill('Sot, 21:30')
    await pageB.locator('.chip').filter({ hasText: 'Kafe' }).first().click().catch(() => {})
    await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
    await pageB.waitForTimeout(4000)

    await onboard(pageC, { firstName: 'ProvaC', lastName: 'Chat', email: EMAIL_C, age: 27, photoPath: PHOTO_A })
    await dismissQuizIfOpen(pageC)

    // ProvaC requests join
    await pageC.getByText('Realtime Test Café').first().click()
    await pageB.waitForTimeout(500)
    const joinBtn = pageC.getByRole('button', { name: /Kërko|Bashkohu|Eja bashkohu/i }).first()
    if (await joinBtn.isVisible().catch(() => false)) await joinBtn.click()
    await pageC.waitForTimeout(2000)

    // ProvaB approves
    await pageB.getByText('Realtime Test Café').first().click().catch(() => {})
    await pageB.waitForTimeout(800)
    const approve = pageB.getByRole('button', { name: /Aprovo|Prano/i }).first()
    if (await approve.isVisible().catch(() => false)) await approve.click()
    await pageB.waitForTimeout(2000)

    // ProvaC confirms seat / pay stub
    await pageC.bringToFront()
    await pageC.getByText('Realtime Test Café').first().click().catch(() => {})
    const confirm = pageC.getByRole('button', { name: /Konfirmo|Pag/i }).first()
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await pageC.waitForTimeout(1500)
    const pay = pageC.getByRole('button', { name: /Paguaj|Konfirmo vendin/i }).first()
    if (await pay.isVisible().catch(() => false)) await pay.click()
    await pageC.waitForTimeout(2000)

    // open chat both sides
    const openChat = async (page) => {
      const chatTab = page.getByRole('button', { name: /Chat|Bised/i }).first()
      if (await chatTab.isVisible().catch(() => false)) await chatTab.click()
      else await page.getByText(/Chat/i).first().click().catch(() => {})
      await page.waitForTimeout(2000)
    }
    await openChat(pageB)
    await openChat(pageC)

    t2.consoleB = logsBChat.filter((l) => /Chat channel|REALTIME|ejaBashkohu/.test(l))
    t2.consoleC = logsCChat.filter((l) => /Chat channel|REALTIME|ejaBashkohu/.test(l))
    t2.subscribedB = t2.consoleB.some((l) => l.includes('SUBSCRIBED'))
    t2.subscribedC = t2.consoleC.some((l) => l.includes('SUBSCRIBED'))

    if (t2.subscribedB && t2.subscribedC) {
      const msg = 'realtime-proof-12345'
      const input = pageB.locator('input[placeholder*="Mesazh"], textarea, .chat-input input').first()
      await input.fill(msg)
      await pageB.getByRole('button', { name: /Dërgo|Send/i }).click().catch(async () => {
        await pageB.keyboard.press('Enter')
      })
      await pageC.waitForTimeout(5000)
      t2.tab2ChatText = await pageC.evaluate(() => {
        const chat = document.querySelector('.chat-msgs, .chat-body, .messages') || document.body
        return chat.innerText
      })
      t2.tab2Screenshot = await shot(pageC, 't2-tab2-after-5s')
      t2.pass = t2.tab2ChatText.includes(msg)
    } else {
      t2.pass = false
      t2.blocked = 'SUBSCRIBED not seen in both consoles'
      t2.debugCreateClient = 'single match: hajde/src/supabaseClient.js'
    }
    report.tests.test2 = t2
    report.consoleLogsB = logsB
    report.consoleLogsBChat = logsBChat
    report.consoleLogsCChat = logsCChat

  } catch (err) {
    report.fatal = { message: err.message, stack: err.stack }
  } finally {
    writeJson('report.json', report)
    console.log(JSON.stringify(report, null, 2))
    await browser.close()
  }
})()
