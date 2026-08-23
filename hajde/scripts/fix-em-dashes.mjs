/**
 * Remove em dashes (—) from user-facing string literals in src/ and index.html.
 * Skips // and * comment lines. Does not introduce "--".
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function isCommentLine(line) {
  const t = line.trimStart()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/')
}

function transformEmDashText(text) {
  let r = text

  // Step subtitles: "Step X of 4 — ..."
  r = r.replace(/ nga 4 — /g, ' nga 4: ')
  r = r.replace(/ von 4 — /g, ' von 4: ')
  r = r.replace(/ of 4 — /g, ' of 4: ')
  r = r.replace(/ од 4 — /g, ' од 4: ')

  // CTA taglines
  r = r.replace(/ — falas/g, ', falas')
  r = r.replace(/ — kostenlos/g, ', kostenlos')
  r = r.replace(/ — free/g, ', free')
  r = r.replace(/ — бесплатно/g, ', бесплатно')

  // Personality quiz options
  r = r.replace(/Introvert — /g, 'Introvert, ')
  r = r.replace(/Ekstrovert — /g, 'Ekstrovert, ')
  r = r.replace(/Introvertiert — /g, 'Introvertiert, ')
  r = r.replace(/Extrovertiert — /g, 'Extrovertiert, ')
  r = r.replace(/Extrovert — /g, 'Extrovert, ')
  r = r.replace(/Интроверт — /g, 'Интроверт, ')
  r = r.replace(/Екстроверт — /g, 'Екстроверт, ')

  // Geographic ranges (lowercase after dash)
  r = r.replace(/Kosovës — nga /g, 'Kosovës, nga ')
  r = r.replace(/Kosovo — from /g, 'Kosovo, from ')
  r = r.replace(/Kosovos — von /g, 'Kosovos, von ')
  r = r.replace(/Кosovo — /g, 'Кosovo, ')
  r = r.replace(/Rugovë — çdo /g, 'Rugovë. Çdo ')
  r = r.replace(/Rugova — /g, 'Rugova. ')
  r = r.replace(/Ругова — /g, 'Ругова. ')

  // Empty / placeholder em dash
  r = r.replace(/'—'/g, "'-'")
  r = r.replace(/"—"/g, '"-"')
  r = r.replace(/\|\| "—"/g, '|| "-"')

  // Label separators in time/location templates
  r = r.replace(/\(${citySeg}\) — /g, '(${citySeg}), ')
  r = r.replace(/ — \$\{/g, ', ${')

  // Clause break: capitalize word after period
  r = r.replace(/ — ([a-zëç])/g, (_, c) => `. ${c.toUpperCase()}`)
  r = r.replace(/ — ([A-ZËÇ])/g, '. $1')

  // Any remaining em dash surrounded by spaces
  r = r.replace(/ — /g, ', ')

  return r
}

function processFile(filePath) {
  const rel = path.relative(root, filePath)
  const original = fs.readFileSync(filePath, 'utf8')
  const lines = original.split('\n')
  const changes = []

  const next = lines.map((line, idx) => {
    if (!line.includes('—')) return line
    if (isCommentLine(line)) return line

    const updated = transformEmDashText(line)
    if (updated !== line) {
      changes.push({ line: idx + 1, before: line.trim(), after: updated.trim() })
    }
    return updated
  })

  if (changes.length) {
    fs.writeFileSync(filePath, next.join('\n'), 'utf8')
  }
  return { rel, changes }
}

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue
      walk(p, acc)
    } else if (/\.(jsx?|html)$/.test(ent.name)) {
      acc.push(p)
    }
  }
  return acc
}

const files = [
  ...walk(path.join(root, 'src')),
  path.join(root, 'index.html'),
]

const allChanges = []
for (const f of files) {
  const { rel, changes } = processFile(f)
  if (changes.length) allChanges.push({ file: rel, changes })
}

console.log(JSON.stringify(allChanges, null, 2))
console.error(`Updated ${allChanges.length} files`)
