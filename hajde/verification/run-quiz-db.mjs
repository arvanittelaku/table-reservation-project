import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE = 'http://localhost:5173'
const OUT = path.join(__dirname, 'evidence', 'local')
const PHOTO = path.resolve(__dirname, '..', 'test-assets', 'photo-a.jpg')
const ts = Date.now()

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: /Eja bashkohu/i }).first().click()
  await page.getByRole('textbox', { name: 'Emri', exact: true }).fill('QuizUser')
  await page.getByRole('textbox', { name: 'Mbiemri' }).fill('Test')
  await page.getByPlaceholder('Email-i yt').fill(`ejabashkohu+quiz.${ts}@gmail.com`)
  await page.getByPlaceholder('Fjalëkalimi').fill('testpass123')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.getByRole('button', { name: 'Vazhdo' }).click()
  await page.locator('input[type="file"]').setInputFiles(PHOTO)
  await page.waitForTimeout(1200)
  const sk = page.getByRole('button', { name: /Vazhdo pa foto/i })
  if (await sk.isVisible().catch(() => false)) await sk.click()
  await page.getByRole('button', { name: 'Jam nga Kosova' }).click()
  await page.waitForTimeout(4000)

  await page.getByText('Fillo →').click()
  await page.waitForTimeout(600)
  const meta = await page.locator('.sheet-hdr .meta').textContent()
  const dots = await page.locator('.quiz-dot').count()
  // answer all 5 via auto-advance
  for (let i = 0; i < 5; i++) {
    await page.locator('.ob-choice .choice').first().click()
    await page.waitForTimeout(300)
  }
  const finish = page.getByRole('button', { name: 'Përfundo' })
  if (await finish.isVisible().catch(() => false)) await finish.click()
  await page.waitForTimeout(2500)

  const userId = await page.evaluate(async () => (await (await import('/src/supabaseClient.js')).sb.auth.getUser()).data.user?.id)
  const taste = await page.evaluate(async (uid) => {
    const { sb } = await import('/src/supabaseClient.js')
    const { data } = await sb.from('taste_profiles').select('*').eq('user_id', uid).maybeSingle()
    return data
  }, userId)

  const R = { meta, dots, userId, taste }
  fs.writeFileSync(path.join(OUT, 'report-quiz-db.json'), JSON.stringify(R, null, 2))
  console.log(JSON.stringify(R, null, 2))
  await browser.close()
})()
