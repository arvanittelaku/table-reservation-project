/** Focused TEST 2 (realtime) + TEST 5 (share) with correct join/approve/pay flow */
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

async function createTable(page, { cafe, area, time }) {
  await page.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await page.locator('#f-cafe').fill(cafe)
  await page.locator('#f-area').fill(area || '')
  await page.locator('#f-time').fill(time)
  await page.getByRole('button', { name: /Hape tavolin/i }).click()
  await page.waitForTimeout(3500)
}

async function openTable(page, title) {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(200)
  await page.getByText(title).first().click({ force: true })
  await page.waitForTimeout(1000)
}

async function completePayment(page) {
  const confirmBtn = page.getByRole('button', { name: /Konfirmo vendin/i })
  await confirmBtn.waitFor({ state: 'visible', timeout: 15000 })
  await confirmBtn.click()
  await page.waitForTimeout(800)
  await page.getByPlaceholder('Numri i kartelës').fill('4242 4242 4242 4242')
  await page.getByPlaceholder('MM/VV').fill('12/30')
  await page.getByPlaceholder('CVC').fill('123')
  await page.getByPlaceholder('Emri në kartelë').fill('Test User')
  await page.getByRole('button', { name: /Paguaj.*konfirmo/i }).click()
  await page.waitForTimeout(3000)
  const ok = page.getByRole('button', { name: /Shko te tavolina/i })
  if (await ok.isVisible().catch(() => false)) await ok.click()
  await page.waitForTimeout(1000)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const ctxC = await browser.newContext()
  const pageB = await ctxB.newPage()
  const pageC = await ctxC.newPage()
  pageB.on('dialog', (d) => d.accept())
  pageC.on('dialog', (d) => d.accept())
  const logsB = []; const logsC = []
  pageB.on('console', (m) => logsB.push(m.text()))
  pageC.on('console', (m) => logsC.push(m.text()))

  await reg(pageB, `ejabashkohu+rtb2.${ts}@gmail.com`, 'ProvaB')
  await reg(pageC, `ejabashkohu+rtc2.${ts}@gmail.com`, 'ProvaC')

  // ── TEST 2 setup ──
  await createTable(pageB, { cafe: 'Realtime Test Café', area: 'Dardania', time: 'Sot, 21:30' })

  await openTable(pageC, 'Realtime Test Café')
  await pageC.getByRole('button', { name: /Kërko t'i bashkohesh/i }).click()
  await pageC.waitForTimeout(2000)
  R.guestStatusAfterRequest = await pageC.locator('.sheet').innerText().then(t => t.slice(0, 200)).catch(() => null)

  await pageB.bringToFront()
  await openTable(pageB, 'Realtime Test Café')
  R.pranoVisible = await pageB.getByRole('button', { name: /Prano/i }).first().isVisible().catch(() => false)
  await pageB.getByRole('button', { name: /Prano/i }).first().click()
  await pageB.waitForTimeout(3500)
  R.hostSheetAfterApprove = await pageB.locator('.sheet').innerText().then(t => t.slice(0, 300)).catch(() => null)

  await pageC.bringToFront()
  await openTable(pageC, 'Realtime Test Café')
  await completePayment(pageC)
  R.guestStatusAfterPay = await pageC.getByRole('button', { name: /Ndaje planin/i }).isVisible().catch(() => false)

  // Open chat both — detail sheet should still be open
  R.test2_consoleB_beforeSend = [...logsB]
  R.test2_consoleC_beforeSend = [...logsC]

  const msg = 'realtime-proof-12345'
  const chatInputB = pageB.locator('input[placeholder*="esazh"], input[placeholder*="Mesazh"]')
  R.chatInputVisibleB = await chatInputB.isVisible().catch(() => false)
  if (R.chatInputVisibleB) {
    await chatInputB.fill(msg)
    await pageB.getByRole('button', { name: /Dërgo/i }).click()
  }

  await pageC.bringToFront()
  await openTable(pageC, 'Realtime Test Café')
  await pageC.waitForTimeout(5000)

  R.test2_consoleB = logsB.filter((l) => /Chat channel|REALTIME|ejaBashkohu/.test(l))
  R.test2_consoleC = logsC.filter((l) => /Chat channel|REALTIME|ejaBashkohu/.test(l))
  R.test2_chatSectionC = await pageC.locator('.chat').innerText().catch(() => null)
  await pageC.screenshot({ path: path.join(OUT, 't2-final-tab2.png') })
  R.test2_messageInChatC = (R.test2_chatSectionC || '').includes(msg)

  // ── TEST 5 share (guest joined on Treff table) ──
  await createTable(pageB, { cafe: 'Treff Caffe', area: 'Dardania', time: 'Sot, 20:00' })
  await openTable(pageC, 'Treff Caffe')
  await pageC.getByRole('button', { name: /Kërko t'i bashkohesh/i }).click()
  await pageB.bringToFront(); await openTable(pageB, 'Treff Caffe')
  await pageB.getByRole('button', { name: /Prano/i }).first().click()
  await pageC.bringToFront(); await openTable(pageC, 'Treff Caffe')
  await completePayment(pageC)

  await pageC.evaluate(() => { window.__s = null; navigator.clipboard.writeText = async (t) => { window.__s = t } })
  const share = pageC.getByRole('button', { name: /Ndaje planin/i })
  R.test5_visible = await share.isVisible().catch(() => false)
  if (R.test5_visible) {
    await share.click()
    await pageC.waitForTimeout(400)
    R.test5_clipboard = await pageC.evaluate(() => window.__s)
  }
  R.test5_expected = 'Po shkoj te tavolina "Treff Caffe" (Dardania, Prishtinë) — Sot, 20:00, përmes ejaBashkohu. Nëse s\'të lajmërohem 2 orë pas, më merr në telefon.'

  // no area
  await pageB.bringToFront()
  await createTable(pageB, { cafe: 'NoArea Venue', area: '', time: 'Sot, 21:00' })
  await openTable(pageC, 'NoArea Venue')
  await pageC.getByRole('button', { name: /Kërko t'i bashkohesh/i }).click()
  await pageB.bringToFront(); await openTable(pageB, 'NoArea Venue')
  await pageB.getByRole('button', { name: /Prano/i }).first().click()
  await pageC.bringToFront(); await openTable(pageC, 'NoArea Venue')
  await completePayment(pageC)
  await pageC.evaluate(() => { window.__s2 = null; navigator.clipboard.writeText = async (t) => { window.__s2 = t } })
  if (await pageC.getByRole('button', { name: /Ndaje planin/i }).isVisible().catch(() => false)) {
    await pageC.getByRole('button', { name: /Ndaje planin/i }).click()
    R.test5_noArea = await pageC.evaluate(() => window.__s2)
  }

  fs.writeFileSync(path.join(OUT, 'report-final.json'), JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
})()
