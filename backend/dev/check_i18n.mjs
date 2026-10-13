#!/usr/bin/env node
// i18n guard for the web app (hajde/src).
//  1. every key present in Albanian (sq, the source language) exists in en, de and mk
//     (and no locale has string-vs-list/section type mismatches or different {{vars}});
//  2. heuristic scan of .tsx/.ts sources for user-visible text that bypasses t():
//     JSX text nodes, user-facing attributes (placeholder, aria-label, title, alt, label),
//     toast/alert/confirm/setError calls with literal strings, and toLocale*String with a
//     hard-coded locale.
// Exit code 1 on any finding.  Usage: node backend/dev/check_i18n.mjs [--verbose]
import ts from '/opt/npm-tools/node_modules/typescript/lib/typescript.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = path.join(ROOT, 'hajde/src')
const LOC_DIR = path.join(SRC, 'i18n/locales')
const LANGS = ['sq', 'en', 'de', 'mk']
const VERBOSE = process.argv.includes('--verbose')
const problems = []
const fail = (kind, msg) => problems.push(`[${kind}] ${msg}`)

// ── 1. locale key parity ────────────────────────────────────────────────────
// Transpile the locale tree (plain TS object literals) into a temp dir and import it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-'))
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p)
  }
  return out
}
for (const f of walk(LOC_DIR)) {
  const js = ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from\s+(['"])(\.{1,2}\/[^'"]+?)\1/g, (_m, q, s) => `from ${q}${s}.mjs${q}`)
  const out = path.join(tmp, path.relative(LOC_DIR, f)).replace(/\.tsx?$/, '.mjs')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, js)
}
const dicts = {}
for (const l of LANGS) dicts[l] = (await import(pathToFileURL(path.join(tmp, `${l}.mjs`)).href)).default
fs.rmSync(tmp, { recursive: true, force: true })

const kind = (v) => (Array.isArray(v) ? 'list' : typeof v === 'string' ? 'string' : v && typeof v === 'object' ? 'section' : typeof v)
const vars = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (kind(v) === 'section') flatten(v, key, out)
    else out[key] = v
  }
  return out
}
const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(dicts[l])]))
// Strings that are legitimately the same in every language (brand, symbols, formats, numbers).
const SAME_OK = /^(ejaBashkohu|ejabashkohu|WhatsApp|Google|Apple|Facebook|Instagram|TikTok|Stripe|PayPal|OK|Email|E-mail|Premium|Basic|Pro|VIP|FAQ|Zoom|Jitsi|PDF|Wi-?Fi|SMS|ID|URL|IBAN|CVC|€|\$|%|[\d\s.,:/+\-–—€%()·•…|x×]*|\{\{\w+\}\}[\s\S]{0,6}|[A-Z]{1,4})$/i
let sameCount = 0
for (const l of LANGS.filter((x) => x !== 'sq')) {
  for (const [key, v] of Object.entries(flat.sq)) {
    const o = flat[l][key]
    if (o === undefined) { fail('missing-key', `${l}: ${key}`); continue }
    if (kind(o) !== kind(v)) { fail('type-mismatch', `${l}: ${key} is ${kind(o)}, sq has ${kind(v)}`); continue }
    if (kind(v) === 'string') {
      if (vars(o) !== vars(v)) fail('placeholder', `${l}: ${key} uses {{${vars(o)}}} but sq uses {{${vars(v)}}}`)
      if (o === v && v.trim().length > 3 && !SAME_OK.test(v.trim()) && /[a-zëç]{4,}/i.test(v)) {
        // identical to Albanian: almost always an untranslated copy
        if (/[ëçË]|\b(dhe|për|një|është|nuk|të|së|apo|ose|tënd|ke|kemi)\b/i.test(v)) fail('untranslated', `${l}: ${key} = ${JSON.stringify(v)}`)
        else if (VERBOSE) { sameCount++; console.log(`  (same as sq) ${l}: ${key} = ${JSON.stringify(v)}`) }
      }
    }
  }
  for (const key of Object.keys(flat[l])) if (!(key in flat.sq) && VERBOSE) console.log(`  (extra, not in sq) ${l}: ${key}`)
}
// Albanian-only words in en/de/mk values, and English chrome in sq values
const SQ_WORDS = /\b(dhe|për|është|nuk|një|tavolin\w*|kërko\w*|mësim\w*|vazhdo|anulo|ruaj|hyr|regjistrohu|fjalëkalim\w*|përdorues\w*)\b/i
const EN_IN_SQ = /\b(the|and|your|please|loading|save|cancel|search|sign in|sign up|continue|settings|delete|tables?)\b/i
for (const l of ['en', 'de', 'mk']) for (const [key, v] of Object.entries(flat[l])) {
  if (typeof v === 'string' && SQ_WORDS.test(v) && v !== flat.sq[key]) fail('albanian-in-' + l, `${key} = ${JSON.stringify(v)}`)
}
for (const [key, v] of Object.entries(flat.sq)) {
  if (typeof v === 'string' && EN_IN_SQ.test(v.replace(/\{\{\w+\}\}/g, ''))) fail('english-in-sq', `${key} = ${JSON.stringify(v)}`)
}

// ── 2. hard-coded UI text in sources ────────────────────────────────────────
// Words/strings allowed to appear literally in JSX (brands, symbols, cities, units).
const WHITELIST = new Set([
  'ejaBashkohu', 'ejabashkohu', 'eja', 'Bashkohu', 'WhatsApp', 'Google', 'Apple', 'Facebook', 'Instagram', 'TikTok',
  'Prishtinë', 'Prishtina', 'Prizren', 'Pejë', 'Peja', 'Gjakovë', 'Ferizaj', 'Gjilan', 'Mitrovicë', 'Tiranë', 'Shkup',
  'Skopje', 'Tetovë', 'Fushë', 'Kosovë', 'Kosova', 'Kosovo', 'Veriut', 'Hani', 'Elezit', 'Zubin', 'Potok', 'Durrës', 'Vlorë', 'Shkodër', 'OK', 'PDF', 'SQ', 'EN', 'DE', 'MK', 'Shqip', 'English', 'Deutsch',
  'Македонски', 'Stripe', 'Premium', 'VIP', 'iOS', 'Android', 'PWA', 'Jitsi', 'Zoom', 'GPS', 'ID', 'AI', 'Admin',
])
const isWhitelisted = (s) => {
  const words = s.match(/[\p{L}]+/gu) || []
  return words.every((w) => WHITELIST.has(w) || w.length < 2)
}
const NOT_TEXT = /^\s*(https?:\/\/\S*|[\w@./-]+\.(sql|ts|tsx|js|png|jpe?g|svg|webp)|[\w.-]+@[\w.-]+)\s*$/i
const hasWords = (s) => /\p{L}{2,}/u.test(s) && !NOT_TEXT.test(s) && !isWhitelisted(s.trim())
// Files that only hold data keys (stored Albanian values, city coordinates, hand-made sq date words).
const DATA_FILES = /(lib\/(geo|kosovoGeo|matchScore|tasteInterests|wednesdayQuiz|format|formatEventTime|lessonSubjects|wedQuizLangs|langCodes|localizeTableDescription)\.ts)$/
const UI_ATTRS = new Set(['placeholder', 'aria-label', 'title', 'alt', 'label', 'aria-description', 'aria-placeholder'])
const MSG_CALLS = /^(toast|alert|confirm|prompt|setError|setErr|setMsg|setMessage|setNotice|setInfo|setStatus|showToast|notify|setToast|setHint|setWarning)$/
// Opt-out comment on the line or the line above:  // i18n-ignore
const sources = walk(SRC).filter((f) => !f.includes(`${path.sep}i18n${path.sep}locales${path.sep}`) && !/\.test\.|\.spec\./.test(f))
let scanned = 0
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = text.split('\n')
  const rel = path.relative(ROOT, file)
  scanned++
  const report = (node, what, s) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line
    if (/i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '')) return
    fail('hardcoded', `${rel}:${line + 1} ${what}: ${JSON.stringify(s.trim().slice(0, 80))}`)
  }
  const literal = (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text
    : ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ') : null)
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const s = node.getText().replace(/\s+/g, ' ')
      if (hasWords(s)) report(node, 'JSX text', s)
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText()
      if (UI_ATTRS.has(name)) {
        let s = null
        if (ts.isStringLiteral(node.initializer)) s = node.initializer.text
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) s = literal(node.initializer.expression)
        if (s && hasWords(s)) report(node, `${name}=`, s)
      }
    } else if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // {'Some text'} / {`Text ${x}`} directly as a child, and {cond ? 'a' : 'b'}
      const exprs = ts.isConditionalExpression(node.expression) ? [node.expression.whenTrue, node.expression.whenFalse]
        : ts.isBinaryExpression(node.expression) ? [node.expression.right] : [node.expression]
      for (const e of exprs) { const s = literal(e); if (s && hasWords(s)) report(node, 'JSX string', s) }
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression.getText(sf).split('.').pop()
      const args = node.arguments || []
      if (MSG_CALLS.test(callee) && args.length) {
        const s = literal(args[0])
        if (s && hasWords(s)) report(node, `${callee}()`, s)
      }
      if (/^toLocale(Date|Time)?String$/.test(callee) || /^(DateTimeFormat|NumberFormat|RelativeTimeFormat)$/.test(callee)) {
        const a0 = args[0]
        if (a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) && /^[a-z]{2}(-[A-Z]{2})?$/.test(a0.text)) report(node, `${callee} with fixed locale`, a0.text)
      }
    }
    // Any other string literal that is clearly Albanian prose (ë/ç plus a space, or common
    // Albanian function words) is UI text living outside the locale files, unless it is a
    // data key (object key / comparison with stored values) or a city name.
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !DATA_FILES.test(rel)) {
      const s = node.text
      const p = node.parent
      const isKey = p && ((ts.isPropertyAssignment(p) && p.name === node) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) ||
        (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(sf))) || ts.isCaseClause(p) || ts.isElementAccessExpression(p) ||
        (ts.isCallExpression(p) && /^(includes|has|get|getItem|setItem|removeItem|startsWith|endsWith|rpc|from|select|eq|order|log|warn|error|debug|t|tList|querySelector)$/.test(p.expression.getText(sf).split('.').pop())))
      if (!isKey && /\p{L}/u.test(s) && !isWhitelisted(s) && !NOT_TEXT.test(s) &&
          (/[ëçËÇ]\S*\s+\S|\s\S*[ëçËÇ]/.test(s) || /\b(dhe|për|është|nuk|një|tënd|tëndë|ke|duhet|mund)\b/i.test(s))) report(node, 'Albanian literal', s)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// ── report ─────────────────────────────────────────────────────────────────
const keyCount = Object.keys(flat.sq).length
if (problems.length) {
  const byKind = {}
  for (const p of problems) { const k = p.match(/^\[([^\]]+)\]/)[1]; byKind[k] = (byKind[k] || 0) + 1 }
  for (const p of problems) console.log(p)
  console.log(`\ncheck_i18n: FAIL — ${problems.length} problem(s) ${JSON.stringify(byKind)} (sq keys: ${keyCount}, files scanned: ${scanned})`)
  process.exit(1)
}
console.log(`check_i18n: OK — ${keyCount} keys present in sq/en/de/mk, ${scanned} source files without hard-coded UI text${VERBOSE ? `, ${sameCount} same-as-sq strings listed` : ''}`)
