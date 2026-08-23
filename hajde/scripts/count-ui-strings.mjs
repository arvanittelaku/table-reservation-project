/**
 * Rough inventory of user-facing UI strings (discovery only).
 */
import fs from 'fs'
import path from 'path'

const ROOT = 'src'
const files = []
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (/\.(jsx|js)$/.test(f)) files.push(p)
  }
}
walk(ROOT)

const UI_FILES = files.filter(
  (f) =>
    !f.includes('api/translate') &&
    !f.includes('supabaseClient') &&
    !f.includes('main.jsx') &&
    !f.endsWith('wedQuizLangs.js'),
)

const albanianRe =
  /[ëçËÇ]|tavolin|Kërkes|Hyr|Vazhdo|Nikoq|Faleminderit|Duhet|Nuk |Llogari|Fjalëkalim|Mesazh|Profil|Shiko|Prano|Refuz|Regjistr|Çaktiviz|Bashkoh|mysafir|pezull|Raport/i

function extractStrings(src) {
  const out = []
  for (const m of src.matchAll(/[`'"]([^`'"]{2,140})[`'"]/g)) {
    const s = m[1].trim()
    if (s.length < 2) continue
    if (/^https?:|^[a-z_\-]+$|className|supabase|\.jsx|rgb|#[0-9a-f]{3,8}/i.test(s)) continue
    if (albanianRe.test(s) || /^(Hyr|Dil|Po,|Më |S'|Jam )/.test(s)) out.push(s)
  }
  for (const m of src.matchAll(/>\s*([^<{][^<{]{2,80}?)\s*</g)) {
    const s = m[1].replace(/\s+/g, ' ').trim()
    if (albanianRe.test(s) && !s.includes('{')) out.push(s)
  }
  return out
}

const all = new Set()
const staticSet = new Set()
const dynamicSet = new Set()
const byFile = {}
const byKind = {
  buttons: 0,
  headings: 0,
  placeholders: 0,
  toasts: 0,
  errors: 0,
  forms: 0,
  emptyStates: 0,
  onboarding: 0,
  admin: 0,
  legal: 0,
  other: 0,
}

function classify(s, file) {
  const rel = file.replace(/\\/g, '/')
  if (rel.includes('errorMap')) return 'errors'
  if (rel.includes('AdminPanel')) return 'admin'
  if (rel.includes('TermsOfService') || rel.includes('PrivacyPolicy')) return 'legal'
  if (/showToast|S'ka |Asnjë|Bosh|ende/.test(s)) {
    if (/S'ka |Asnjë|Bosh|ende/i.test(s)) return 'emptyStates'
    if (file.includes('showToast') || s.length < 100) return 'toasts'
  }
  if (/placeholder|Email-i|Fjalëkalim|Emri|Mbiemri|Shkruaj|Zgjedh datën/i.test(s)) return 'forms'
  if (/^(Hyr|Dil|Vazhdo|Prano|Refuz|Mbyll|Krijo|Anulo|Dërgo|Kopjo|Raport)/i.test(s) && s.length < 35)
    return 'buttons'
  if (s.length < 50 && /^[A-ZÇË]/.test(s) && !s.includes('.')) return 'headings'
  if (/Regjistr|Profil i shijeve|Jam nga|foto|onboard|quiz|Vlerësim/i.test(s)) return 'onboarding'
  if (/S'ka |Asnjë tavolin|ende/.test(s)) return 'emptyStates'
  return 'other'
}

for (const file of UI_FILES) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = file.replace(/\\/g, '/')
  const strs = extractStrings(src)
  byFile[rel] = strs.length
  for (const s of strs) {
    all.add(s)
    if (/\$\{|\{[a-zA-Z_]+\}|`.*\$\{/.test(s)) dynamicSet.add(s)
    else staticSet.add(s)
    const k = classify(s, rel)
    byKind[k] = (byKind[k] || 0) + 1
  }
}

// Dedupe category counts using unique per kind
const kindUnique = {}
for (const file of UI_FILES) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = file.replace(/\\/g, '/')
  for (const s of new Set(extractStrings(src))) {
    const k = classify(s, rel)
    if (!kindUnique[k]) kindUnique[k] = new Set()
    kindUnique[k].add(s)
  }
}

console.log(JSON.stringify({
  filesScanned: UI_FILES.length,
  uniqueStringsApprox: all.size,
  staticUnique: staticSet.size,
  dynamicUnique: dynamicSet.size,
  dynamicPct: Math.round((dynamicSet.size / all.size) * 100),
  kindUniqueCounts: Object.fromEntries(
    Object.entries(kindUnique).map(([k, v]) => [k, v.size]),
  ),
  topFilesByHits: Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([f, c]) => ({ file: f, hits: c })),
  showToastCalls: UI_FILES.reduce(
    (n, f) => n + (fs.readFileSync(f, 'utf8').match(/showToast\(/g) || []).length,
    0,
  ),
  hajdeAppLines: fs.readFileSync('src/HajdeApp.jsx', 'utf8').split('\n').length,
  componentCount: files.filter((f) => f.includes('components/')).length,
}, null, 2))
