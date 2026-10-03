/**
 * Client for the ejaBashkohu Django backend.
 *
 * Exposes the same calls the app already makes (sb.from().select()…,
 * sb.rpc(), sb.auth.*, sb.storage.from(), sb.channel(), sb.functions.invoke())
 * so screens and features are unchanged; everything goes to Django:
 *   /auth/v1/*        accounts, sessions, email links, Google/Apple
 *   /rest/v1/*        table queries and database functions
 *   /storage/v1/*     avatar upload and signed URLs
 *   /functions/v1/*   server functions
 *   /realtime/v1/websocket   live updates (Django Channels)
 * Every call returns { data, error } like before; nothing throws.
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
const SESSION_KEY = 'ejb-auth-session'
const REFRESH_MARGIN_S = 60

/* ───────────────────────── helpers ───────────────────────── */

function makeError(body, status) {
  const e = new Error(body?.message || body?.msg || body?.error || `Request failed (${status})`)
  e.status = status
  if (body?.code) e.code = body.code
  if (body?.error_code) e.error_code = body.error_code
  if (body?.details !== undefined) e.details = body.details
  if (body?.hint !== undefined) e.hint = body.hint
  return e
}

async function parse(res) {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) } catch { return { message: text } }
}

function readStored() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
function writeStored(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* private mode */ }
}

/* ───────────────────────── auth ───────────────────────── */

class Auth {
  constructor(client) {
    this.client = client
    this.session = readStored()
    this.listeners = new Set()
    this.refreshTimer = null
    this.refreshing = null
    this.pendingEvent = null
    this.ready = this._init()
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev) => {
        if (ev.key !== SESSION_KEY) return
        const next = readStored()
        const had = !!this.session
        this.session = next
        this._schedule()
        this._emit(next ? (had ? 'TOKEN_REFRESHED' : 'SIGNED_IN') : 'SIGNED_OUT')
      })
    }
  }

  async _init() {
    // Email links and Google/Apple return with the session in the URL fragment
    // (#access_token=…&type=signup|recovery). Errors (#error=…) stay in the URL
    // for the app to read.
    if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
      const p = new URLSearchParams(window.location.hash.slice(1))
      const session = {
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token'),
        expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
        expires_in: Number(p.get('expires_in') || 3600),
        token_type: 'bearer',
        user: null,
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      const res = await fetch(`${API_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) {
        session.user = await parse(res)
        this._setSession(session)
        this.pendingEvent = p.get('type') === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN'
      }
    }
    if (this.session && this.session.expires_at - REFRESH_MARGIN_S < Date.now() / 1000) {
      await this._refresh()
    } else {
      this._schedule()
    }
  }

  _setSession(session) {
    this.session = session
    writeStored(session)
    this._schedule()
    this.client._onToken(session?.access_token || null)
  }

  _emit(event) {
    for (const cb of this.listeners) {
      try { cb(event, this.session) } catch (err) { console.error(err) }
    }
  }

  _schedule() {
    clearTimeout(this.refreshTimer)
    if (!this.session?.expires_at) return
    const ms = (this.session.expires_at - REFRESH_MARGIN_S) * 1000 - Date.now()
    this.refreshTimer = setTimeout(() => { void this._refresh() }, Math.max(ms, 1000))
  }

  async _refresh() {
    if (!this.session?.refresh_token) return null
    if (this.refreshing) return this.refreshing
    const token = this.session.refresh_token
    this.refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: token }),
        })
        const body = await parse(res)
        if (res.ok) {
          this._setSession(body)
          this._emit('TOKEN_REFRESHED')
          return body
        }
        if (res.status >= 400 && res.status < 500) { // revoked/expired: signed out
          this._setSession(null)
          this._emit('SIGNED_OUT')
        }
        return null
      } catch {
        this._schedule() // offline: try again later, keep the session
        return null
      } finally {
        this.refreshing = null
      }
    })()
    return this.refreshing
  }

  async accessToken() {
    await this.ready
    if (this.session && this.session.expires_at - REFRESH_MARGIN_S < Date.now() / 1000) await this._refresh()
    return this.session?.access_token || null
  }

  async _call(path, { method = 'POST', body, auth = false } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (auth) {
      const t = await this.accessToken()
      if (t) headers.Authorization = `Bearer ${t}`
    }
    try {
      const res = await fetch(`${API_URL}/auth/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const data = await parse(res)
      return res.ok ? { data, error: null } : { data: null, error: makeError(data, res.status) }
    } catch (err) {
      return { data: null, error: makeError({ message: err.message || 'Network error' }, 0) }
    }
  }

  onAuthStateChange(cb) {
    this.listeners.add(cb)
    this.ready.then(() => {
      setTimeout(() => {
        if (!this.listeners.has(cb)) return
        cb('INITIAL_SESSION', this.session)
        if (this.pendingEvent) cb(this.pendingEvent, this.session)
      }, 0)
    })
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } }
  }

  async getSession() {
    await this.accessToken()
    return { data: { session: this.session }, error: null }
  }

  async getUser() {
    const t = await this.accessToken()
    if (!t) return { data: { user: null }, error: makeError({ message: 'Auth session missing!' }, 401) }
    const { data, error } = await this._call('user', { method: 'GET', auth: true })
    if (data && this.session) { this.session = { ...this.session, user: data }; writeStored(this.session) }
    return { data: { user: data }, error }
  }

  async signUp({ email, password, options = {} }) {
    const { data, error } = await this._call('signup', { body: { email, password, options } })
    if (error) return { data: { user: null, session: null }, error }
    if (data.session) {
      this._setSession(data.session)
      this._emit('SIGNED_IN')
    }
    return { data: { user: data.user, session: data.session }, error: null }
  }

  async signInWithPassword({ email, password }) {
    const { data, error } = await this._call('token?grant_type=password', { body: { email, password } })
    if (error) return { data: { user: null, session: null }, error }
    this._setSession(data)
    this._emit('SIGNED_IN')
    return { data: { user: data.user, session: data }, error: null }
  }

  async signOut() {
    if (this.session) await this._call('logout', { auth: true })
    this._setSession(null)
    this._emit('SIGNED_OUT')
    return { error: null }
  }

  async resend({ type, email, options = {} }) {
    const { error } = await this._call('resend', { body: { type, email, options } })
    return { data: {}, error }
  }

  async resetPasswordForEmail(email, { redirectTo } = {}) {
    const { error } = await this._call('recover', { body: { email, redirect_to: redirectTo } })
    return { data: {}, error }
  }

  async updateUser(attributes) {
    const { data, error } = await this._call('user', { method: 'PUT', body: attributes, auth: true })
    if (error) return { data: { user: null }, error }
    if (this.session) this._setSession({ ...this.session, user: data })
    this._emit('USER_UPDATED')
    return { data: { user: data }, error: null }
  }

  async signInWithOAuth({ provider, options = {} }) {
    const { data } = await this._call('settings', { method: 'GET' })
    if (data && !data.external?.[provider]) {
      return { data: null, error: makeError({ message: 'Unsupported provider: provider is not enabled', code: 'provider_disabled' }, 400) }
    }
    const url = `${API_URL}/auth/v1/authorize?${new URLSearchParams({ provider, redirect_to: options.redirectTo || window.location.origin })}`
    window.location.assign(url)
    return { data: { provider, url }, error: null }
  }
}

/* ───────────────────────── table queries ───────────────────────── */

class Query {
  constructor(client, table) {
    this.client = client
    this.req = { table, action: 'select', select: '*', filters: [], order: [] }
  }

  select(columns = '*', { count, head } = {}) {
    if (this.req.action === 'select') this.req.select = columns
    else { this.req.returning = true; this.req.select = columns }
    if (count) this.req.count = count
    if (head) this.req.head = true
    return this
  }

  insert(values, { count } = {}) { Object.assign(this.req, { action: 'insert', values, count }); return this }
  upsert(values, { onConflict, ignoreDuplicates, count } = {}) {
    Object.assign(this.req, { action: 'upsert', values, onConflict, ignoreDuplicates, count }); return this
  }
  update(values, { count } = {}) { Object.assign(this.req, { action: 'update', values, count }); return this }
  delete({ count } = {}) { Object.assign(this.req, { action: 'delete', count }); return this }

  _f(col, op, value, negate = false) { this.req.filters.push({ col, op, value, negate }); return this }
  eq(c, v) { return this._f(c, 'eq', v) }
  neq(c, v) { return this._f(c, 'neq', v) }
  gt(c, v) { return this._f(c, 'gt', v) }
  gte(c, v) { return this._f(c, 'gte', v) }
  lt(c, v) { return this._f(c, 'lt', v) }
  lte(c, v) { return this._f(c, 'lte', v) }
  like(c, v) { return this._f(c, 'like', v) }
  ilike(c, v) { return this._f(c, 'ilike', v) }
  is(c, v) { return this._f(c, 'is', v === null ? 'null' : String(v)) }
  in(c, values) { return this._f(c, 'in', values) }
  contains(c, v) { return this._f(c, 'cs', v) }
  containedBy(c, v) { return this._f(c, 'cd', v) }
  overlaps(c, v) { return this._f(c, 'ov', v) }
  match(obj) { Object.entries(obj).forEach(([c, v]) => this._f(c, 'eq', v)); return this }
  not(c, op, v) { return this._f(c, op, v, true) }
  or(expr) { this.req.filters.push({ or: expr }); return this }
  filter(c, op, v) {
    if (op.startsWith('not.')) return this._f(c, op.slice(4), v, true)
    return this._f(c, op, v)
  }
  order(col, { ascending = true, nullsFirst } = {}) { this.req.order.push({ col, ascending, nullsFirst }); return this }
  limit(n) { this.req.limit = n; return this }
  range(from, to) { this.req.offset = from; this.req.limit = to - from + 1; return this }
  single() { this.req.single = true; return this }
  maybeSingle() { this.req.maybeSingle = true; return this }
  returns() { return this }
  throwOnError() { this._throw = true; return this }

  async _run() {
    const out = await this.client._post('/rest/v1/query', this.req)
    if (out.error && this._throw) throw out.error
    return out
  }

  then(resolve, reject) { return this._run().then(resolve, reject) }
}

class RpcCall {
  constructor(client, fn, args) { this.client = client; this.fn = fn; this.args = args || {}; this.mode = null }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  async _run() {
    const out = await this.client._post(`/rest/v1/rpc/${encodeURIComponent(this.fn)}`, this.args)
    if (!out.error && this.mode && Array.isArray(out.data)) {
      if (out.data.length > 1 || (this.mode === 'single' && out.data.length === 0)) {
        return { data: null, error: makeError({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406), status: 406 }
      }
      out.data = out.data[0] ?? null
    }
    return out
  }
  then(resolve, reject) { return this._run().then(resolve, reject) }
}

/* ───────────────────────── storage ───────────────────────── */

class Bucket {
  constructor(client, bucket) { this.client = client; this.bucket = bucket }

  async upload(path, file, { upsert = false, contentType } = {}) {
    const headers = { 'Content-Type': contentType || file?.type || 'application/octet-stream', 'x-upsert': String(!!upsert) }
    const out = await this.client._fetch(`/storage/v1/object/${this.bucket}/${path}`, { method: 'POST', headers, body: file })
    return out.error ? { data: null, error: out.error } : { data: { path, id: out.data?.id, fullPath: out.data?.fullPath }, error: null }
  }

  async remove(paths) {
    return this.client._fetch(`/storage/v1/object/${this.bucket}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
    })
  }

  async createSignedUrls(paths, expiresIn) {
    return this.client._fetch(`/storage/v1/object/sign/${this.bucket}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, expiresIn }),
    })
  }

  async createSignedUrl(path, expiresIn) {
    const { data, error } = await this.createSignedUrls([path], expiresIn)
    if (error) return { data: null, error }
    const row = data?.[0]
    if (!row || row.error) return { data: null, error: makeError({ message: row?.error || 'Object not found' }, 404) }
    return { data: { signedUrl: row.signedUrl }, error: null }
  }
}

/* ───────────────────────── realtime ───────────────────────── */

class Channel {
  constructor(rt, name) { this.rt = rt; this.name = name; this.bindings = []; this.statusCb = null }
  on(type, filter, callback) {
    if (type === 'postgres_changes') this.bindings.push({ id: `${this.name}:${this.bindings.length}:${Math.random().toString(36).slice(2, 8)}`, filter, callback })
    return this
  }
  subscribe(statusCb) { this.statusCb = statusCb || null; this.rt._add(this); return this }
  unsubscribe() { this.rt._remove(this); return Promise.resolve('ok') }
}

class Realtime {
  constructor(client) {
    this.client = client
    this.channels = new Set()
    this.byId = new Map()
    this.ws = null
    this.backoff = 500
    this.closing = false
  }

  _url(token) {
    const base = API_URL.replace(/^http/, 'ws')
    return `${base}/realtime/v1/websocket${token ? `?token=${encodeURIComponent(token)}` : ''}`
  }

  async _connect() {
    if (this.ws && this.ws.readyState <= 1) return
    const token = await this.client.auth.accessToken()
    const ws = new WebSocket(this._url(token))
    this.ws = ws
    ws.onopen = () => {
      this.backoff = 500
      for (const ch of this.channels) this._sendSubs(ch)
    }
    ws.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.type === 'change') {
        const b = this.byId.get(msg.id)
        if (b) { try { b.binding.callback(msg.payload) } catch (err) { console.error(err) } }
      } else if (msg.type === 'subscribed') {
        const b = this.byId.get(msg.id)
        if (!b) return
        b.acked = true
        const ch = b.ch
        if (!ch._announced && ch.bindings.every((x) => this.byId.get(x.id)?.acked)) {
          ch._announced = true
          ch.statusCb?.('SUBSCRIBED')
        }
      }
    }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      for (const ch of this.channels) ch._announced = false
      if (this.channels.size && !this.closing) {
        setTimeout(() => { void this._connect() }, this.backoff)
        this.backoff = Math.min(this.backoff * 2, 15000)
      }
    }
  }

  _sendSubs(ch) {
    if (!this.ws || this.ws.readyState !== 1) return
    for (const b of ch.bindings) {
      const f = b.filter || {}
      this.byId.set(b.id, { ch, binding: b, acked: false })
      this.ws.send(JSON.stringify({ type: 'subscribe', id: b.id, table: f.table, event: f.event || '*', filter: f.filter || '' }))
    }
    if (!ch.bindings.length) ch.statusCb?.('SUBSCRIBED')
  }

  _add(ch) {
    this.channels.add(ch)
    if (this.ws && this.ws.readyState === 1) this._sendSubs(ch)
    else void this._connect()
  }

  _remove(ch) {
    if (!this.channels.delete(ch)) return
    for (const b of ch.bindings) {
      this.byId.delete(b.id)
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'unsubscribe', id: b.id }))
    }
    ch.statusCb?.('CLOSED')
    if (!this.channels.size && this.ws) { this.closing = true; this.ws.close(); this.ws = null; this.closing = false }
  }

  setToken(token) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'auth', token: token || '' }))
  }
}

/* ───────────────────────── client ───────────────────────── */

class BackendClient {
  constructor() {
    this.realtime = new Realtime(this)
    this.auth = new Auth(this)
    this.storage = { from: (bucket) => new Bucket(this, bucket) }
    this.functions = { invoke: (name, { body } = {}) => this._post(`/functions/v1/${name}`, body || {}, true) }
  }

  _onToken(token) { this.realtime?.setToken(token) }

  async _fetch(path, init = {}, retried = false) {
    const headers = { ...(init.headers || {}) }
    const token = await this.auth.accessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    let res
    try {
      res = await fetch(`${API_URL}${path}`, { ...init, headers })
    } catch (err) {
      return { data: null, error: makeError({ message: err.message || 'Network error' }, 0), status: 0 }
    }
    const body = await parse(res)
    if (res.status === 401 && token && !retried && /jwt/i.test(body?.message || '')) {
      await this.auth._refresh()
      return this._fetch(path, init, true)
    }
    if (!res.ok) return { data: null, error: makeError(body, res.status), status: res.status }
    return { data: body, error: null, status: res.status }
  }

  async _post(path, body, raw = false) {
    const out = await this._fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    if (out.error || raw) return { data: out.data, error: out.error, status: out.status }
    return { data: out.data?.data ?? null, count: out.data?.count ?? null, error: null, status: out.status }
  }

  from(table) { return new Query(this, table) }
  rpc(fn, args) { return new RpcCall(this, fn, args) }
  channel(name) { return new Channel(this.realtime, name) }
  removeChannel(ch) { return ch?.unsubscribe() }
  removeAllChannels() { [...this.realtime.channels].forEach((c) => c.unsubscribe()) }
}

export const sb = new BackendClient()
export const API_BASE_URL = API_URL
