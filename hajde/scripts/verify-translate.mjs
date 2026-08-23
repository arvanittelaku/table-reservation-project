/**
 * Verify chat translation targets multiple languages correctly.
 * Run: node scripts/verify-translate.mjs
 */
import { translateText } from '../src/api/translate.js'

const SOURCE_SQ = 'Mirëdita, si jeni?'
const SOURCE_EN = 'Hello, how are you today?'

async function testDirectTargets() {
  console.log('\n=== TEST 1: direct translate with explicit targets (Albanian source) ===')
  const targets = ['en', 'de', 'it', 'fr', 'tr']
  const results = {}
  for (const target of targets) {
    const out = await translateText(SOURCE_SQ, { target, source: 'sq' })
    results[target] = out
    console.log(`target=${target}: ${JSON.stringify(out)}`)
  }
  const unique = new Set(Object.values(results))
  const pass = unique.size === targets.length
  console.log('allDifferent:', pass, 'uniqueCount:', unique.size)
  return { pass, results }
}

async function testReaderLanguages() {
  console.log('\n=== TEST 2: reader language resolution (chat scenario) ===')

  const albanianReader = await translateText(SOURCE_EN, {
    viewerLangs: ['Shqip'],
    tableLangs: ['sq', 'en'],
    browserLocale: 'sq-AL',
  })
  console.log('English msg → Albanian reader:', JSON.stringify(albanianReader))

  const englishReader = await translateText(SOURCE_SQ, {
    viewerLangs: ['English'],
    tableLangs: ['sq', 'en'],
    browserLocale: 'sq-AL',
  })
  console.log('Albanian msg → English reader:', JSON.stringify(englishReader))

  const germanReader = await translateText(SOURCE_SQ, {
    viewerLangs: ['Deutsch'],
    tableLangs: ['sq', 'de'],
    browserLocale: 'de-DE',
  })
  console.log('Albanian msg → German reader:', JSON.stringify(germanReader))

  const pass =
    /përshëndetje|jeni/i.test(albanianReader) &&
    /good|hello|how|afternoon/i.test(englishReader) &&
    /guten|tag|geht|wie/i.test(germanReader)

  return { pass, albanianReader, englishReader, germanReader }
}

async function testFailureHandling() {
  console.log('\n=== TEST 3: graceful failure when API is down ===')
  const origFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('Simulated translation outage')
  }
  try {
    await translateText(SOURCE_SQ, { target: 'en', source: 'sq' })
    console.log('unexpected success')
    return { pass: false }
  } catch (err) {
    const msg = err.message || String(err)
    console.log('caughtError:', JSON.stringify(msg))
    const pass = msg.includes('Përkthimi dështoi')
    return { pass, error: msg }
  } finally {
    globalThis.fetch = origFetch
  }
}

async function main() {
  const t1 = await testDirectTargets()
  const t2 = await testReaderLanguages()
  const t3 = await testFailureHandling()

  console.log('\n=== SUMMARY ===')
  console.log('TEST 1:', t1.pass ? 'PASS' : 'FAIL')
  console.log('TEST 2:', t2.pass ? 'PASS' : 'FAIL')
  console.log('TEST 3:', t3.pass ? 'PASS' : 'FAIL')

  process.exit(t1.pass && t2.pass && t3.pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
