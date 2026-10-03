// Shared helpers for the full-stack browser tests (real app + Django + Postgres + Redis).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const SITE = process.env.SITE || 'http://localhost:5173'
export const API = process.env.API || 'http://localhost:8000'
export const MAIL_DIR = '/home/claude/table-reservation-project/backend/var/mail'
export const SHOTS = '/tmp/pgtest_admin/shots/real/'
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
export function check(name, ok, info = '') {
  results.push([name, !!ok])
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && info ? `  [${String(info).slice(0, 300)}]` : ''))
}
export function summary() {
  const failed = results.filter((r) => !r[1])
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  return failed.length
}

export function sql(q) {
  return execSync(`psql -h /tmp -p 54329 -U postgres -d ejb_dev -tA -c ${JSON.stringify(q)}`).toString().trim()
}

export async function api(pathname, body, token, method = 'POST') {
  const r = await fetch(API + pathname, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  })
  const text = await r.text()
  try { return { status: r.status, ...JSON.parse(text) } } catch { return { status: r.status, text } }
}
export async function token(email, password = 'Test1234!') {
  return (await api('/auth/v1/token?grant_type=password', { email, password })).access_token
}

export function mailTo(to, sinceMs) {
  const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).map((f) => path.join(MAIL_DIR, f)) : []
  for (const f of files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)) {
    if (fs.statSync(f).mtimeMs < sinceMs) continue
    const t = fs.readFileSync(f, 'utf8')
    if (t.includes(`To: ${to}`)) return t
  }
  return ''
}
export async function waitMail(to, sinceMs, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const m = mailTo(to, sinceMs)
    if (m) return m
    await new Promise((r) => setTimeout(r, 300))
  }
  return ''
}
export const verifyLink = (mail) => (mail.match(/(http:\/\/\S+\/auth\/v1\/verify\?token=[\w-]+&type=\w+)/) || [])[1]

let browser
export async function launch() {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  return browser
}
export async function close() { await browser?.close() }

export async function newPage({ lang = 'sq', width = 400, height = 860, geo } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write', ...(geo ? ['geolocation'] : [])],
    ...(geo ? { geolocation: geo } : {}),
  })
  const p = await ctx.newPage()
  p.errs = []; p.bad = []
  p.on('pageerror', (e) => p.errs.push(e.message))
  p.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 400) p.bad.push(`${r.status()} ${r.url().replace(API, '')}`) })
  await p.goto(SITE + '/')
  await p.evaluate((l) => { localStorage.clear(); localStorage.setItem('ejabashkohu-ui-lang', l) }, lang)
  await p.reload()
  await p.waitForTimeout(1200)
  return p
}

export async function signIn(p, email, password = 'Test1234!') {
  await p.getByText('Hyr', { exact: true }).first().click().catch(() => {})
  await p.waitForTimeout(300)
  await p.locator('input[type=email]').first().fill(email)
  await p.locator('.input-password-wrap input').first().fill(password)
  await p.locator('form button[type=submit]').first().click()
  await p.waitForTimeout(2500)
  // Basic users without a home city must pick one first
  if (await p.locator('.pl-city-picker, .pl-sheet select, select').first().isVisible().catch(() => false)) {
    const save = p.locator('button', { hasText: 'Ruaj' })
    if (await save.count()) { await save.first().click().catch(() => {}); await p.waitForTimeout(800) }
  }
}

export async function bodyText(p) { return (await p.locator('body').innerText()).replace(/\s+/g, ' ') }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function section(name, fn) {
  console.log(`\n── ${name}`)
  try { await fn() } catch (err) { check(`${name}: finished without crashing`, false, err.message.split('\n')[0]) }
}

export async function makeJpeg(p, w = 3000, h = 4000) {
  // a large, photo-like PNG (faces are not detected in headless, the skin-tone heuristic passes)
  return Buffer.from(await p.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')
    for (let i = 0; i < w; i += 150) for (let j = 0; j < h; j += 150) { const v = 60 + Math.floor(Math.random() * 140); x.fillStyle = `rgb(${v + 40},${v},${v - 30})`; x.fillRect(i, j, 150, 150) }
    const d = x.getImageData(0, 0, w, h); for (let k = 0; k < d.data.length; k += 4) { const n = (Math.random() * 24) | 0; d.data[k] += n; d.data[k + 1] += n; d.data[k + 2] += n } x.putImageData(d, 0, 0)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, [w, h]))
}
