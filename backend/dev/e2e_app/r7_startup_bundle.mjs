// R7: startup_bundle RPC — verifies that a single call returns profile +
// taste_profile + affinity + badges + plan and that the data matches what
// the individual endpoints return.
import { api, check, close, launch, section, sql, summary, token, rpc as _rpc } from './lib.mjs'

const STAMP = Date.now()

const rpc = (name, args, tok) => api(`/rest/v1/rpc/${name}`, args, tok)

async function makeUser(tag) {
  const email = `r7.${tag}.${STAMP}@gmail.com`
  await api('/auth/v1/signup', { email, password: 'Test1234!', options: { data: { first_name: 'Bundle', last_name: tag } } })
  sql(`update auth.users set email_confirmed_at=now() where email='${email}'`)
  const tok = await token(email)
  const uid = sql(`select id from auth.users where email='${email}'`)
  await rpc('complete_onboarding', { p_first_name: 'Bundle', p_last_name: tag, p_age: 28 }, tok)
  return { email, tok, uid }
}

async function run() {
  const { close: closeAll } = await launch()
  try {
    const u = await makeUser('main')

    await section('startup_bundle — basic user', async () => {
      const bundle = await rpc('startup_bundle', {}, u.tok)

      check('has profile key', bundle && 'profile' in bundle)
      check('has taste key', bundle && 'taste' in bundle)
      check('has affinity key', bundle && 'affinity' in bundle)
      check('has badges key', bundle && 'badges' in bundle)
      check('has plan key', bundle && 'plan' in bundle)
      check('profile is not null', bundle?.profile !== null)
      check('profile first_name correct', bundle?.profile?.first_name === 'Bundle')
      check('profile age correct', bundle?.profile?.age === 28)
      check('taste is null (not yet done)', bundle?.taste === null)
      check('affinity is array', Array.isArray(bundle?.affinity))
      check('badges is array', Array.isArray(bundle?.badges))
      check('plan tier is basic', bundle?.plan?.tier === 'basic')
      check('plan has table_limit', 'table_limit' in (bundle?.plan || {}))
      check('plan has tables_this_month', typeof bundle?.plan?.tables_this_month === 'number')
    })

    await section('startup_bundle — after home city set', async () => {
      await rpc('set_home_city', { p_city: 'Prishtinë' }, u.tok)
      const bundle = await rpc('startup_bundle', {}, u.tok)
      check('profile.home_city populated', bundle?.profile?.home_city === 'Prishtinë')
      check('plan.home_city populated', bundle?.plan?.home_city === 'Prishtinë')
    })

    await section('startup_bundle — matches my_plan', async () => {
      const bundle = await rpc('startup_bundle', {}, u.tok)
      const plan = await rpc('my_plan', {}, u.tok)
      check('tier matches', bundle?.plan?.tier === plan?.tier)
      check('table_limit matches', bundle?.plan?.table_limit === plan?.table_limit)
      check('tables_this_month matches', bundle?.plan?.tables_this_month === plan?.tables_this_month)
    })

    await section('startup_bundle — anon call rejected', async () => {
      let threw = false
      try { await rpc('startup_bundle', {}, null) } catch { threw = true }
      check('anon call throws', threw)
    })

  } finally {
    await closeAll()
  }

  summary()
}

run().catch((e) => { console.error(e); process.exit(1) })
