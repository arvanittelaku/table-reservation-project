/**
 * Test recovery link landing behavior on production.
 * Usage: node verification/test-reset-links.mjs <verify-url> [label]
 */
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'https://ejabashkohu.com'
const verifyUrl = process.argv[2]
const label = process.argv[3] || 'link'
const OUT = path.join('verification/evidence/password-reset-double', String(Date.now()))

if (!verifyUrl) {
  console.error('Usage: node verification/test-reset-links.mjs <verify-url> [label]')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })

async function testLink(contextLabel, url, contextOptions = {}) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext(contextOptions)
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 390, height: 844 })

  const authEvents = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (/auth|recovery|PASSWORD|session/i.test(t)) authEvents.push(t)
  })

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)

  const finalUrl = page.url()
  const hash = await page.evaluate(() => window.location.hash)
  const search = await page.evaluate(() => window.location.search)
  const bodyText = (await page.locator('body').innerText()).slice(0, 800)
  const resetForm = await page.getByText('Vendos fjalëkalim të ri').count()
  const signInHero = await page.locator('.hero-login').count()
  const landing = await page.locator('.landing-host').count()
  const mainFeed = await page.locator('.sidebar').count()
  const forgotSent = (await page.locator('body').innerText()).includes('Kontrollo email') ||
    bodyText.toLowerCase().includes('check your email')

  await page.screenshot({ path: path.join(OUT, `${contextLabel}.png`), fullPage: true })
  await ctx.close()
  await browser.close()

  return {
    label: contextLabel,
    startUrl: url,
    finalUrl,
    hash,
    search,
    resetFormVisible: resetForm > 0,
    signInHeroVisible: signInHero > 0,
    landingVisible: landing > 0,
    mainFeedVisible: mainFeed > 0,
    forgotSentVisible: forgotSent,
    hasOtpExpired: hash.includes('otp_expired') || search.includes('otp_expired') || bodyText.toLowerCase().includes('expired'),
    hasAccessDenied: hash.includes('access_denied') || search.includes('access_denied'),
    bodySnippet: bodyText,
    authEvents,
  }
}

const result = await testLink(label, verifyUrl)
fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
console.log('Evidence:', OUT)
