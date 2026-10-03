// Live updates through Django Channels: delivery, filters, and row permissions.
// node backend/dev/e2e_realtime.mjs   (backend on :8000, dev DB seeded)
const API = 'http://localhost:8000'
let pass = 0, fail = 0
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && info ? `  [${info}]` : '')) }
const post = async (path, body, token) => (await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json()
const login = async (email) => (await post('/auth/v1/token?grant_type=password', { email, password: 'Test1234!' }))
const AFTER_BAD = 'after bad token ' + Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function client(token) {
  const ws = new WebSocket(`ws://localhost:8000/realtime/v1/websocket?token=${token}`)
  const events = []; const acks = []
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'change') events.push(m); if (m.type === 'subscribed') acks.push(m.id) }
  const ready = new Promise((r) => { ws.onopen = r })
  return { ws, events, acks, ready, sub: (id, table, filter = '', event = '*') => ws.send(JSON.stringify({ type: 'subscribe', id, table, event, filter })) }
}

const a = await login('arta.krasniqi@gmail.com')
const b = await login('blerim.gashi@gmail.com')
const admin = await login('support@ejabashkohu.com')
const A = client(a.access_token), B = client(b.access_token)
await Promise.all([A.ready, B.ready])
A.sub('n', 'notifications', `user_id=eq.${a.user.id}`)
B.sub('n', 'notifications')                       // no filter: must still only get his own
A.sub('feed', 'tables', 'city=eq.Prishtinë')
A.sub('feedPeja', 'tables', 'city=eq.Pejë')
await sleep(600)
check('subscriptions acknowledged', A.acks.length === 3 && B.acks.length === 1, JSON.stringify([A.acks, B.acks]))

// a notification for Arta, sent by the admin
await post('/rest/v1/rpc/admin_notify_user', { p_user: a.user.id, p_message: 'Realtime test' }, admin.access_token)
await sleep(1500)
const aNote = A.events.find((e) => e.id === 'n' && e.payload.table === 'notifications')
check("Arta receives her notification live", aNote && aNote.payload.eventType === 'INSERT' && aNote.payload.new.body === 'Realtime test', JSON.stringify(A.events).slice(0, 200))
check("Blerim does NOT receive Arta's notification (row permission check)", !B.events.some((e) => e.payload.new?.user_id === a.user.id))

// admin cancels a Prishtinë table -> feed subscribers for Prishtinë get it, Pejë filter does not
const t = await post('/rest/v1/query', { table: 'tables', select: 'id, title, city', filters: [{ col: 'city', op: 'eq', value: 'Prishtinë' }, { col: 'status', op: 'eq', value: 'open' }, { col: 'host_id', op: 'neq', value: a.user.id }, { col: 'host_id', op: 'neq', value: b.user.id }, { col: 'event_datetime', op: 'gt', value: new Date().toISOString() }], limit: 1 }, admin.access_token)
const table = t.data[0]
A.events.length = 0
const host = (await post('/rest/v1/query', { table: 'tables', select: 'host_id', filters: [{ col: 'id', op: 'eq', value: table.id }], single: true }, admin.access_token)).data
await post('/rest/v1/rpc/admin_cancel_table', { p_table: table.id, p_reason: 'Realtime test' }, admin.access_token)
await sleep(1500)
// cancelled tables are no longer visible to normal users (RLS), so the update is not leaked as a row
const feedEv = A.events.filter((e) => e.id === 'feed')
check('cancelled table is not pushed to users who can no longer see it', !feedEv.some((e) => e.payload.new?.status === 'cancelled'), JSON.stringify(feedEv).slice(0, 200))
check('Pejë filter receives nothing for Prishtinë', !A.events.some((e) => e.id === 'feedPeja'))
A.events.length = 0
await post('/rest/v1/rpc/admin_restore_table', { p_table: table.id }, admin.access_token)
await sleep(1500)
const restored = A.events.find((e) => e.id === 'feed' && e.payload.new?.id === table.id)
check('restored table pushed to the Prishtinë feed', restored && restored.payload.new.status === 'open', JSON.stringify(A.events).slice(0, 300))

// joins touch the table (activity_at) so seat counts update live
A.events.length = 0
await fetch(API + '/health')
await post('/rest/v1/query', { table: 'notifications', action: 'update', values: { read: true }, filters: [{ col: 'user_id', op: 'eq', value: a.user.id }] }, a.access_token)
await sleep(1200)
check('UPDATE events arrive (notifications marked read)', A.events.some((e) => e.id === 'n' && e.payload.eventType === 'UPDATE'))

// token refresh over the socket
A.ws.send(JSON.stringify({ type: 'auth', token: 'garbage' }))
await sleep(300)
await post('/rest/v1/rpc/admin_notify_user', { p_user: a.user.id, p_message: AFTER_BAD }, admin.access_token)
await sleep(1200)
const leaked = A.events.filter((e) => e.payload.new?.body === AFTER_BAD); check('after an invalid token the socket stops receiving private rows', !leaked.length, JSON.stringify(leaked).slice(0, 300))

A.ws.close(); B.ws.close()
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
