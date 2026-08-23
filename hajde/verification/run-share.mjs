import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'
const OUT = path.join(__dirname, 'evidence', 'local')
const PHOTO = path.resolve(__dirname, '..', 'test-assets', 'photo-a.jpg')
const ts = Date.now()

async function quickJoinGuest(guest, host, title) {
  await guest.goto(BASE + '/'); await guest.waitForTimeout(2000)
  await guest.getByText(title).first().click({ force: true }); await guest.waitForTimeout(800)
  await guest.getByRole('button', { name: /Kërko t'i bashkohesh/i }).click(); await guest.waitForTimeout(1500)
  const guestId = await guest.evaluate(async () => (await (await import('/src/supabaseClient.js')).sb.auth.getUser()).data.user?.id)
  await host.bringToFront(); await host.reload(); await host.waitForTimeout(2000)
  await host.getByText(title).first().click({ force: true }); await host.waitForTimeout(800)
  await host.evaluate(async ({ title, guestId }) => {
    const { sb } = await import('/src/supabaseClient.js')
    const { data: t } = await sb.from('tables').select('id').eq('title', title).order('created_at', { ascending: false }).limit(1).maybeSingle()
    const { data: r } = await sb.from('requests').select('id').eq('table_id', t.id).eq('user_id', guestId).maybeSingle()
    await sb.rpc('approve_request', { p_request: r.id })
  }, { title, guestId })
  await guest.bringToFront(); await guest.reload(); await guest.waitForTimeout(2000)
  await guest.getByText(title).first().click({ force: true }); await guest.waitForTimeout(800)
  await guest.getByRole('button', { name: /Konfirmo vendin/i }).click()
  await guest.getByPlaceholder('Numri i kartelës').fill('4242 4242 4242 4242')
  await guest.getByPlaceholder('MM/VV').fill('12/30')
  await guest.getByPlaceholder('CVC').fill('123')
  await guest.getByPlaceholder('Emri në kartelë').fill('Test User')
  await guest.getByRole('button', { name: /Paguaj.*konfirmo/i }).click()
  await guest.waitForTimeout(3000)
  if (await guest.getByRole('button', { name: /Shko te tavolina/i }).isVisible().catch(() => false))
    await guest.getByRole('button', { name: /Shko te tavolina/i }).click()
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctxH = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const ctxG = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const host = await ctxH.newPage(); const guest = await ctxG.newPage()
  host.on('dialog', (d) => d.accept()); guest.on('dialog', (d) => d.accept())

  async function reg(p, email) {
    await p.goto(BASE + '/')
    await p.getByRole('button', { name: /Eja bashkohu/i }).first().click()
    await p.getByRole('textbox', { name: 'Emri', exact: true }).fill(email.includes('h') ? 'Host' : 'Guest')
    await p.getByRole('textbox', { name: 'Mbiemri' }).fill('Share')
    await p.getByPlaceholder('Email-i yt').fill(email)
    await p.getByPlaceholder('Fjalëkalimi').fill('testpass123')
    await p.getByRole('checkbox').check()
    await p.getByRole('button', { name: 'Vazhdo' }).click()
    await p.getByRole('button', { name: 'Vazhdo' }).click()
    await p.locator('input[type="file"]').setInputFiles(PHOTO)
    await p.waitForTimeout(1200)
    const sk = p.getByRole('button', { name: /Vazhdo pa foto/i })
    if (await sk.isVisible().catch(() => false)) await sk.click()
    await p.getByRole('button', { name: 'Jam nga Kosova' }).click()
    await p.waitForTimeout(3500)
    if (await p.getByRole('button', { name: 'Më vonë' }).isVisible().catch(() => false)) await p.getByRole('button', { name: 'Më vonë' }).click()
  }

  await reg(host, `ejabashkohu+shh.${ts}@gmail.com`)
  await reg(guest, `ejabashkohu+shg.${ts}@gmail.com`)

  await host.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await host.locator('#f-cafe').fill('Treff Caffe')
  await host.locator('#f-area').fill('Dardania')
  await host.locator('#f-time').fill('Sot, 20:00')
  await host.getByRole('button', { name: /Hape tavolin/i }).click()
  await host.waitForTimeout(3000)

  await quickJoinGuest(guest, host, 'Treff Caffe')
  await guest.getByText('Treff Caffe').first().click({ force: true })
  await guest.evaluate(() => { window.__c = null; navigator.clipboard.writeText = async (t) => { window.__c = t } })
  await guest.getByRole('button', { name: /Ndaje planin/i }).click()
  await guest.waitForTimeout(400)
  const clip = await guest.evaluate(() => window.__c)

  await host.locator('button').filter({ hasText: /Hap tavolin/i }).first().click()
  await host.locator('#f-cafe').fill('NoArea Venue')
  await host.locator('#f-area').fill('')
  await host.locator('#f-time').fill('Sot, 21:00')
  await host.getByRole('button', { name: /Hape tavolin/i }).click()
  await host.waitForTimeout(2500)
  await quickJoinGuest(guest, host, 'NoArea Venue')
  await guest.getByText('NoArea Venue').first().click({ force: true })
  await guest.evaluate(() => { window.__c2 = null; navigator.clipboard.writeText = async (t) => { window.__c2 = t } })
  await guest.getByRole('button', { name: /Ndaje planin/i }).click()
  const clipNoArea = await guest.evaluate(() => window.__c2)

  const expected = 'Po shkoj te tavolina "Treff Caffe" (Dardania, Prishtinë) — Sot, 20:00, përmes ejaBashkohu. Nëse s\'të lajmërohem 2 orë pas, më merr në telefon.'
  const R = { clip, clipNoArea, expected, exactMatch: clip === expected, noAreaHasEmptyComma: clipNoArea?.includes('(,') }
  fs.writeFileSync(path.join(OUT, 'report-share.json'), JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
})()
