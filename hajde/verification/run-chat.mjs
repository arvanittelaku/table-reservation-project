/** TEST 2 chat delivery with SQL-assisted approve + membership */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'
const OUT = path.join(__dirname, 'evidence', 'local')
const PHOTO = path.resolve(__dirname, '..', 'test-assets', 'photo-a.jpg')
const ts = Date.now()
const PW = 'testpass123'

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
  const authResp = page.waitForResponse((r) => r.url().includes('/auth/v1/signup') || r.url().includes('/auth/v1/token'), { timeout: 20000 })
  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  await authResp.catch(() => null)
  await page.waitForTimeout(3000)
  if (await page.getByRole('button', { name: 'Më vonë' }).isVisible().catch(() => false))
    await page.getByRole('button', { name: 'Më vonë' }).click()
  const uid = await page.evaluate(async () => {
    const { sb } = await import('/src/supabaseClient.js')
    const { data } = await sb.auth.getUser()
    return data.user?.id
  })
  return uid
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctxB = await browser.newContext()
  const ctxC = await browser.newContext()
  const pageB = await ctxB.newPage()
  const pageC = await ctxC.newPage()
  pageB.on('dialog', (d) => d.accept())
  pageC.on('dialog', (d) => d.accept())
  const logsB = []; const logsC = []
  pageB.on('console', (m) => logsB.push(m.text()))
  pageC.on('console', (m) => logsC.push(m.text()))

  const hostId = await reg(pageB, `ejabashkohu+chatb.${ts}@gmail.com`, 'ProvaB')
  const guestId = await reg(pageC, `ejabashkohu+chatc.${ts}@gmail.com`, 'ProvaC')

  await pageB.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await pageB.locator('#f-cafe').fill('Realtime Test Café')
  await pageB.locator('#f-area').fill('Dardania')
  await pageB.locator('#f-time').fill('Sot, 21:30')
  const createWait = pageB.waitForResponse((r) => r.url().includes('/rest/v1/tables') && r.request().method() === 'POST', { timeout: 20000 })
  await pageB.getByRole('button', { name: /Hape tavolin/i }).click()
  const createResp = await createWait
  const created = await createResp.json()
  const tableId = created?.[0]?.id || created?.id

  // request join via RPC from guest page
  await pageC.goto(BASE + '/')
  await pageC.waitForTimeout(2000)
  await pageC.getByText('Realtime Test Café').first().click({ force: true })
  await pageC.waitForTimeout(800)
  const reqWait = pageC.waitForResponse((r) => r.url().includes('/rest/v1/rpc/request_join'), { timeout: 15000 })
  await pageC.getByRole('button', { name: /Kërko t'i bashkohesh/i }).click()
  const reqResp = await reqWait.catch(() => null)
  const reqBody = reqResp ? await reqResp.text() : null

  // fetch request id
  const idsFile = path.join(OUT, 'chat-ids.json')
  fs.writeFileSync(idsFile, JSON.stringify({ tableId, hostId, guestId, reqBody }, null, 2))

  // SQL approve via npx supabase not available - use direct REST from page evaluate
  const sqlResult = await pageB.evaluate(async ({ tableId, guestId }) => {
    const { sb } = await import('/src/supabaseClient.js')
    const { data: reqs } = await sb.from('requests').select('id,status').eq('table_id', tableId).eq('user_id', guestId).maybeSingle()
    if (!reqs?.id) return { error: 'no request row', reqs }
    const { error: appErr } = await sb.rpc('approve_request', { p_request: reqs.id })
    return { requestId: reqs.id, approveError: appErr?.message || null }
  }, { tableId, guestId })

  await pageC.bringToFront()
  await pageC.reload()
  await pageC.waitForTimeout(2500)
  await pageC.getByText('Realtime Test Café').first().click({ force: true })
  await pageC.waitForTimeout(800)

  // payment
  const payBtn = pageC.getByRole('button', { name: /Konfirmo vendin/i })
  if (await payBtn.isVisible().catch(() => false)) {
    await payBtn.click()
    await pageC.waitForTimeout(600)
    await pageC.getByPlaceholder('Numri i kartelës').fill('4242 4242 4242 4242')
    await pageC.getByPlaceholder('MM/VV').fill('12/30')
    await pageC.getByPlaceholder('CVC').fill('123')
    await pageC.getByPlaceholder('Emri në kartelë').fill('Test User')
    await pageC.getByRole('button', { name: /Paguaj.*konfirmo/i }).click()
    await pageC.waitForTimeout(3000)
    if (await pageC.getByRole('button', { name: /Shko te tavolina/i }).isVisible().catch(() => false))
      await pageC.getByRole('button', { name: /Shko te tavolina/i }).click()
  }

  await pageB.bringToFront()
  await pageB.reload(); await pageB.waitForTimeout(2000)
  await pageB.getByText('Realtime Test Café').first().click({ force: true })
  await pageC.bringToFront(); await pageC.reload(); await pageC.waitForTimeout(2000)
  await pageC.getByText('Realtime Test Café').first().click({ force: true })
  await pageC.waitForTimeout(2000)

  const msg = 'realtime-proof-12345'
  const inputB = pageB.locator('input[placeholder*="esazh"], input[placeholder*="Mesazh"]')
  const canSendB = await inputB.isVisible().catch(() => false)
  if (canSendB) {
    await inputB.fill(msg)
    await pageB.getByRole('button', { name: /Dërgo/i }).click()
  }

  await pageC.waitForTimeout(5000)
  const chatC = await pageC.locator('.chat').innerText().catch(() => '')
  await pageC.screenshot({ path: path.join(OUT, 't2-chat-tab2-proof.png') })

  const R = {
    tableId, hostId, guestId, reqBody, sqlResult,
    consoleB: logsB.filter((l) => l.includes('Chat channel')),
    consoleC: logsC.filter((l) => l.includes('Chat channel')),
    canSendB,
    chatC,
    messageDelivered: chatC.includes(msg),
  }
  fs.writeFileSync(path.join(OUT, 'report-chat.json'), JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
})()
