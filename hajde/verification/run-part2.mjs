import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '')
const OUT = path.join(__dirname, 'evidence', 'local')
const PHOTO = path.resolve(__dirname, '..', 'test-assets', 'photo-a.jpg')
const ts = Date.now()
const PW = 'testpass123'

fs.mkdirSync(OUT, { recursive: true })
const R = { base: BASE, ts }

const attach = (p) => p.on('dialog', (d) => d.accept())

async function reg(page, email, first) {
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill(first)
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill('User')
  await page.getByPlaceholder('Email-i yt').fill(email)
  await page.getByPlaceholder('Fjalëkalimi').fill(PW)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.locator('input[type="file"]').setInputFiles(PHOTO)
  await page.waitForTimeout(1200)
  const sk = page.getByRole('button', { name: /Vazhdo pa foto/i })
  if (await sk.isVisible().catch(() => false)) await sk.click()
  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  await page.waitForTimeout(3500)
  if (await page.getByRole('button', { name: 'Më vonë' }).isVisible().catch(() => false))
    await page.getByRole('button', { name: 'Më vonë' }).click()
}

async function openTable(page, title) {
  await page.getByText(title, { exact: false }).first().click({ force: true })
  await page.waitForTimeout(900)
}

async function tryPayJoin(page) {
  for (const pat of [/Kërko/i, /bashkohu/i, /Aprovo/i, /Konfirmo vendin/i, /Konfirmo ulësen/i, /Paguaj/i]) {
    const b = page.getByRole('button', { name: pat }).first()
    if (await b.isVisible().catch(() => false)) {
      await b.click()
      await page.waitForTimeout(1200)
    }
  }
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const ctxC = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const pageB = await ctxB.newPage()
  const pageC = await ctxC.newPage()
  attach(pageB); attach(pageC)
  const logsB = []; const logsC = []
  pageB.on('console', (m) => logsB.push(m.text()))
  pageC.on('console', (m) => logsC.push(m.text()))

  const eB = `ejabashkohu+shareb.${ts}@gmail.com`
  const eC = `ejabashkohu+sharec.${ts}@gmail.com`

  await reg(pageB, eB, 'HostB')
  await reg(pageC, eC, 'GuestC')

  // Host creates table
  await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await pageB.locator('#f-cafe').fill('Treff Caffe')
  await pageB.locator('#f-area').fill('Dardania')
  await pageB.locator('#f-time').fill('Sot, 20:00')
  await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
  await pageB.waitForTimeout(3000)

  // Guest requests + host approves + guest pays
  await openTable(pageC, 'Treff Caffe')
  await tryPayJoin(pageC)
  await pageB.bringToFront()
  await openTable(pageB, 'Treff Caffe')
  await tryPayJoin(pageB)
  await pageC.bringToFront()
  await openTable(pageC, 'Treff Caffe')
  await tryPayJoin(pageC)

  // TEST 5 — share as joined guest
  await pageC.evaluate(() => { window.__share = null; navigator.clipboard.writeText = async (t) => { window.__share = t } })
  const shareBtn = pageC.getByRole('button', { name: /Ndaje planin/i })
  R.test5_shareVisible = await shareBtn.isVisible().catch(() => false)
  if (R.test5_shareVisible) {
    await shareBtn.click()
    await pageC.waitForTimeout(500)
    R.test5_clipboard = await pageC.evaluate(() => window.__share)
    R.test5_clipboardRead = await pageC.evaluate(async () => {
      try { return await navigator.clipboard.readText() } catch (e) { return String(e) }
    })
  }
  R.test5_expected = 'Po shkoj te tavolina "Treff Caffe" (Dardania, Prishtinë) — Sot, 20:00, përmes ejaBashkohu. Nëse s\'të lajmërohem 2 orë pas, më merr në telefon.'

  // No-area table
  await pageB.bringToFront()
  await pageB.keyboard.press('Escape').catch(() => {})
  await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await pageB.locator('#f-cafe').fill('NoArea Venue')
  await pageB.locator('#f-area').fill('')
  await pageB.locator('#f-time').fill('Sot, 21:00')
  await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
  await pageB.waitForTimeout(2500)
  await openTable(pageC, 'NoArea Venue')
  await tryPayJoin(pageC)
  await pageB.bringToFront(); await openTable(pageB, 'NoArea Venue'); await tryPayJoin(pageB)
  await pageC.bringToFront(); await openTable(pageC, 'NoArea Venue'); await tryPayJoin(pageC)
  await pageC.evaluate(() => { window.__share2 = null; navigator.clipboard.writeText = async (t) => { window.__share2 = t } })
  if (await pageC.getByRole('button', { name: /Ndaje planin/i }).isVisible().catch(() => false)) {
    await pageC.getByRole('button', { name: /Ndaje planin/i }).click()
    R.test5_noArea = await pageC.evaluate(() => window.__share2)
  }

  // TEST 2 — Realtime Test Café
  await pageB.bringToFront()
  await pageB.keyboard.press('Escape').catch(() => {})
  await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await pageB.locator('#f-cafe').fill('Realtime Test Café')
  await pageB.locator('#f-area').fill('Dardania')
  await pageB.locator('#f-time').fill('Sot, 21:30')
  await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
  await pageB.waitForTimeout(3000)

  await openTable(pageC, 'Realtime Test Café')
  await tryPayJoin(pageC)
  await pageB.bringToFront(); await openTable(pageB, 'Realtime Test Café'); await tryPayJoin(pageB)
  await pageC.bringToFront(); await openTable(pageC, 'Realtime Test Café'); await tryPayJoin(pageC)

  // Both open chat (host + guest)
  for (const page of [pageB, pageC]) {
    await openTable(page, 'Realtime Test Café')
    await page.waitForTimeout(500)
  }
  R.test2_consoleB = logsB.filter((l) => /Chat channel|REALTIME|ejaBashkohu/.test(l))
  R.test2_consoleC = logsC.filter((l) => /Chat channel|REALTIME|ejaBashkohu/.test(l))

  if (R.test2_consoleB.some((l) => l.includes('SUBSCRIBED')) && R.test2_consoleC.some((l) => l.includes('SUBSCRIBED'))) {
    const msg = 'realtime-proof-12345'
    await pageB.locator('input[placeholder*="esazh"], input[placeholder*="Mesazh"]').first().fill(msg)
    await pageB.getByRole('button', { name: /Dërgo/i }).click().catch(() => pageB.keyboard.press('Enter'))
    await pageC.waitForTimeout(5000)
    R.test2_bodyC = await pageC.evaluate(() => document.body.innerText)
    await pageC.screenshot({ path: path.join(OUT, 't2-tab2-5s.png') })
    R.test2_pass = R.test2_bodyC.includes(msg)
  } else {
    R.test2_pass = false
    R.test2_failReason = 'Missing SUBSCRIBED in one or both tabs'
  }

  // TEST 4 langs
  await pageB.bringToFront()
  await pageB.keyboard.press('Escape').catch(() => {})
  await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await pageB.locator('.lang-chip').filter({ hasText: 'Deutsch' }).click()
  await pageB.locator('.lang-chip').filter({ hasText: 'English' }).click()
  await pageB.locator('.lang-chip').filter({ hasText: 'Français' }).click()
  R.test4_selected = await pageB.locator('.lang-chip.on').allTextContents()
  await pageB.locator('#f-cafe').fill('LangVerify Café')
  await pageB.locator('#f-time').fill('Sot, 22:30')
  await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
  await pageB.waitForTimeout(2500)
  await openTable(pageB, 'LangVerify Café')
  R.test4_detail = await pageB.locator('.langs').first().textContent().catch(() => null)
  await pageB.screenshot({ path: path.join(OUT, 't4-detail.png') })

  fs.writeFileSync(path.join(OUT, 'report-part2.json'), JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
})()
