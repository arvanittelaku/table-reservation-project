/**
 * Bug D extended: live chat messages after approve + seat confirm, no refresh.
 * Run: node scripts/verify-bug-D-chat-live.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.VERIFY_URL || 'https://45c971d9.ejabashkohu.pages.dev'
const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const AUTH_KEY = 'sb-upxxfhvgbmddhyebaiug-auth-token'
const TEST_MSG = 'post-approval-live-test-1'

async function signup(email, firstName, lastName) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass123!',
      data: { first_name: firstName, last_name: lastName, age: 25 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`signup failed: ${JSON.stringify(data)}`)
  return data
}

async function injectSession(page, session) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    ({ key, session }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type,
          user: session.user,
        }),
      )
    },
    { key: AUTH_KEY, session },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
}

async function main() {
  mkdirSync('scripts/screenshots', { recursive: true })
  const ts = Date.now()
  const hostSess = await signup(`dchost${ts}@test.local`, 'HostChat', 'Driver')
  const guestSess = await signup(`dcguest${ts}@test.local`, 'GuestChat', 'Rider')

  const browser = await chromium.launch({ headless: true })
  const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const hostPage = await hostCtx.newPage()
  const guestPage = await guestCtx.newPage()

  const hostLogs = []
  const guestLogs = []
  hostPage.on('console', (m) => {
    const t = m.text()
    if (t.includes('[ejaBashkohu]')) hostLogs.push(t)
  })
  guestPage.on('console', (m) => {
    const t = m.text()
    if (t.includes('[ejaBashkohu]')) guestLogs.push(t)
  })

  await injectSession(hostPage, hostSess)
  await injectSession(guestPage, guestSess)

  // Host creates ride
  await hostPage.locator('.fab').click({ force: true })
  await hostPage.waitForTimeout(600)
  await hostPage.locator('button.mode-btn', { hasText: 'Vozitje' }).click()
  await hostPage.locator('#f-tocity').selectOption({ index: 2 })
  await hostPage.locator('#f-pickup').fill('Chat test pickup')
  await hostPage.locator('#f-time').fill('19:30')
  await hostPage.locator('button', { hasText: 'Hape vozitjen' }).click()
  await hostPage.waitForTimeout(3500)

  const tblRes = await fetch(
    `${SB_URL}/rest/v1/tables?host_id=eq.${hostSess.user.id}&order=created_at.desc&limit=1&select=id,title`,
    { headers: { apikey: ANON, Authorization: `Bearer ${hostSess.access_token}` } },
  )
  const table = (await tblRes.json())[0]
  const ridePrefix = table.title.split('→')[0].trim()

  // Guest opens ride and requests (stays on sheet — no refresh)
  await guestPage.locator('.card').filter({ hasText: ridePrefix }).first().click()
  await guestPage.waitForTimeout(2000)
  await guestPage.locator('button', { hasText: 'bashkohesh' }).click()
  await guestPage.waitForTimeout(2500)

  // Host approves
  await hostPage.locator('.card').filter({ hasText: ridePrefix }).first().click()
  await hostPage.waitForTimeout(1500)
  await hostPage.locator('button', { hasText: 'Prano' }).first().click()
  await hostPage.waitForTimeout(3000)

  // Guest confirms free seat (still same sheet, no refresh)
  await guestPage.locator('button', { hasText: /Konfirmo ulësen/i }).click()
  await guestPage.waitForTimeout(4000)

  const chatInputVisible = await guestPage.locator('.chat-input input').count()
  await guestPage.screenshot({
    path: 'scripts/screenshots/bug-D-guest-chat-unlocked.png',
    fullPage: false,
  })

  // Host sends message while guest keeps table open
  await hostPage.locator('.chat-input input').fill(TEST_MSG)
  await hostPage.locator('.chat-input .send, .chat-input button.send').click()
  await hostPage.waitForTimeout(1000)

  // Guest waits 5s — no clicks, no refresh
  await guestPage.waitForTimeout(5000)

  const guestDomText = await guestPage.locator('.chat-msgs').innerText().catch(() => '')
  const msgInDom = guestDomText.includes(TEST_MSG)
  await guestPage.screenshot({
    path: 'scripts/screenshots/bug-D-guest-after-host-message.png',
    fullPage: false,
  })

  const result = {
    pass: chatInputVisible > 0 && msgInDom,
    tableId: table.id,
    chatInputVisible: chatInputVisible > 0,
    msgInGuestDom: msgInDom,
    guestChatSnippet: guestDomText.slice(0, 300),
    guestChannelLogs: guestLogs.filter((l) => l.includes('Chat channel') || l.includes('Membership channel')),
    hostChannelLogs: hostLogs.filter((l) => l.includes('Chat channel') || l.includes('Membership channel')),
    screenshots: [
      'scripts/screenshots/bug-D-guest-chat-unlocked.png',
      'scripts/screenshots/bug-D-guest-after-host-message.png',
    ],
  }

  console.log(JSON.stringify(result, null, 2))
  await hostCtx.close()
  await guestCtx.close()
  await browser.close()
  process.exit(result.pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
