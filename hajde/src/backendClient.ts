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
import type { DbTableName, DbTables, Json } from './types/db'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
const SESSION_KEY = 'ejb-auth-session'
const REFRESH_MARGIN_S = 60

/* ───────────────────────── types ───────────────────────── */

/** Error returned by every call (never thrown, except by .throwOnError()). */
export interface ApiError extends Error {
  status: number
  code?: string
  error_code?: string
  details?: unknown
  hint?: unknown
  weak_password?: unknown
}

export interface AuthIdentity {
  identity_id: string
  id: string
  user_id: string
  identity_data: Record<string, Json> | null
  provider: string
  provider_id: string
  email: string | null
  created_at: string | null
  updated_at: string | null
  last_sign_in_at: string | null
}

/** The signed-in account (Supabase Auth's user shape, see backend core/accounts.py user_json). */
export interface AuthUser {
  id: string
  aud: string
  role: string
  email: string | null
  email_confirmed_at: string | null
  confirmed_at: string | null
  last_sign_in_at: string | null
  phone: string
  app_metadata: { provider?: string; providers?: string[]; [key: string]: Json | undefined }
  user_metadata: {
    first_name?: string
    last_name?: string
    age?: number | string
    full_name?: string
    name?: string
    given_name?: string
    family_name?: string
    [key: string]: Json | undefined
  }
  identities?: AuthIdentity[]
  created_at: string | null
  updated_at: string | null
  is_anonymous: boolean
}

export interface Session {
  access_token: string
  refresh_token: string
  expires_at: number
  expires_in: number
  token_type: string
  user: AuthUser | null
}

export type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY'
export type AuthListener = (event: AuthEvent, session: Session | null) => void

/** Result of a query: either data or an error. */
export type DbResult<T> =
  | { data: T; error: null; count?: number | null; status: number }
  | { data: null; error: ApiError; count?: number | null; status: number }

type ErrorBody = { message?: string; msg?: string; error?: string; code?: string; error_code?: string; details?: unknown; hint?: unknown } | null

/* ───────────────────────── helpers ───────────────────────── */

function makeError(body: ErrorBody, status: number): ApiError {
  const e = new Error(body?.message || body?.msg || body?.error || `Request failed (${status})`) as ApiError
  e.status = status
  if (body?.code) e.code = body.code
  if (body?.error_code) e.error_code = body.error_code
  if (body?.details !== undefined) e.details = body.details
  if (body?.hint !== undefined) e.hint = body.hint
  return e
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : '') || 'Network error'

// The body is whatever the endpoint returns; callers know its shape.
async function parse<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) as T } catch { return { message: text } as T }
}

function readStored(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null } catch { return null }
}
function writeStored(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* private mode */ }
}

/* ───────────────────────── auth ───────────────────────── */

interface AuthCallOptions { method?: string; body?: unknown; auth?: boolean }
type AuthCallResult<T> = { data: T; error: null } | { data: null; error: ApiError }

class Auth {
  client: BackendClient
  session: Session | null
  listeners = new Set<AuthListener>()
  refreshTimer: ReturnType<typeof setTimeout> | undefined = undefined
  refreshing: Promise<Session | null> | null = null
  pendingEvent: AuthEvent | null = null
  ready: Promise<void>

  constructor(client: BackendClient) {
    this.client = client
    this.session = readStored()
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
      const session: Session = {
        access_token: p.get('access_token') || '',
        refresh_token: p.get('refresh_token') || '',
        expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + Number(p.get('expires_in') || 3600),
        expires_in: Number(p.get('expires_in') || 3600),
        token_type: 'bearer',
        user: null,
      }
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      const res = await fetch(`${API_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      if (res.ok) {
        session.user = await parse<AuthUser>(res)
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

  _setSession(session: Session | null) {
    this.session = session
    writeStored(session)
    this._schedule()
    this.client._onToken(session?.access_token || null)
  }

  _emit(event: AuthEvent) {
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

  async _refresh(): Promise<Session | null> {
    if (!this.session?.refresh_token) return null
    if (this.refreshing) return this.refreshing
    const token = this.session.refresh_token
    this.refreshing = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: token }),
        })
        const body = await parse<Session>(res)
        if (res.ok && body) {
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

  async accessToken(): Promise<string | null> {
    await this.ready
    if (this.session && this.session.expires_at - REFRESH_MARGIN_S < Date.now() / 1000) await this._refresh()
    return this.session?.access_token || null
  }

  async _call<T>(path: string, { method = 'POST', body, auth = false }: AuthCallOptions = {}): Promise<AuthCallResult<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      const t = await this.accessToken()
      if (t) headers.Authorization = `Bearer ${t}`
    }
    try {
      const res = await fetch(`${API_URL}/auth/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const data = await parse<T & ErrorBody>(res)
      return res.ok ? { data: data as T, error: null } : { data: null, error: makeError(data, res.status) }
    } catch (err) {
      return { data: null, error: makeError({ message: errMessage(err) }, 0) }
    }
  }

  onAuthStateChange(cb: AuthListener) {
    this.listeners.add(cb)
    void this.ready.then(() => {
      setTimeout(() => {
        if (!this.listeners.has(cb)) return
        cb('INITIAL_SESSION', this.session)
        if (this.pendingEvent) cb(this.pendingEvent, this.session)
      }, 0)
    })
    return { data: { subscription: { unsubscribe: () => { this.listeners.delete(cb) } } } }
  }

  async getSession(): Promise<{ data: { session: Session | null }; error: null }> {
    await this.accessToken()
    return { data: { session: this.session }, error: null }
  }

  async getUser(): Promise<{ data: { user: AuthUser | null }; error: ApiError | null }> {
    const t = await this.accessToken()
    if (!t) return { data: { user: null }, error: makeError({ message: 'Auth session missing!' }, 401) }
    const { data, error } = await this._call<AuthUser>('user', { method: 'GET', auth: true })
    if (data && this.session) { this.session = { ...this.session, user: data }; writeStored(this.session) }
    return { data: { user: data }, error }
  }

  async signUp({ email, password, options = {} }: { email: string; password: string; options?: { emailRedirectTo?: string; data?: Record<string, Json> } }) {
    const { data, error } = await this._call<{ user: AuthUser | null; session: Session | null }>('signup', { body: { email, password, options } })
    if (error) return { data: { user: null, session: null }, error }
    if (data.session) {
      this._setSession(data.session)
      this._emit('SIGNED_IN')
    }
    return { data: { user: data.user, session: data.session }, error: null }
  }

  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const { data, error } = await this._call<Session>('token?grant_type=password', { body: { email, password } })
    if (error) return { data: { user: null, session: null }, error }
    this._setSession(data)
    this._emit('SIGNED_IN')
    return { data: { user: data.user, session: data }, error: null }
  }

  async signOut(): Promise<{ error: null }> {
    if (this.session) await this._call('logout', { auth: true })
    this._setSession(null)
    this._emit('SIGNED_OUT')
    return { error: null }
  }

  async resend({ type, email, options = {} }: { type: 'signup'; email: string; options?: { emailRedirectTo?: string } }) {
    const { error } = await this._call('resend', { body: { type, email, options } })
    return { data: {}, error }
  }

  async resetPasswordForEmail(email: string, { redirectTo }: { redirectTo?: string } = {}) {
    const { error } = await this._call('recover', { body: { email, redirect_to: redirectTo } })
    return { data: {}, error }
  }

  async updateUser(attributes: { password?: string; email?: string; data?: Record<string, Json> }) {
    const { data, error } = await this._call<AuthUser>('user', { method: 'PUT', body: attributes, auth: true })
    if (error) return { data: { user: null }, error }
    if (this.session) this._setSession({ ...this.session, user: data })
    this._emit('USER_UPDATED')
    return { data: { user: data }, error: null }
  }

  async signInWithOAuth({ provider, options = {} }: { provider: string; options?: { redirectTo?: string } }) {
    const { data } = await this._call<{ external?: Record<string, boolean> }>('settings', { method: 'GET' })
    if (data && !data.external?.[provider]) {
      return { data: null, error: makeError({ message: 'Unsupported provider: provider is not enabled', code: 'provider_disabled' }, 400) }
    }
    const url = `${API_URL}/auth/v1/authorize?${new URLSearchParams({ provider, redirect_to: options.redirectTo || window.location.origin })}`
    window.location.assign(url)
    return { data: { provider, url }, error: null }
  }
}

/* ───────────────────────── table queries ───────────────────────── */

export type FilterValue = string | number | boolean | null | ReadonlyArray<string | number | boolean | null> | Record<string, Json>
type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is' | 'in' | 'cs' | 'cd' | 'ov' | string
interface Filter { col: string; op: FilterOp; value: FilterValue; negate: boolean }
interface QueryRequest {
  table: string
  action: 'select' | 'insert' | 'upsert' | 'update' | 'delete'
  select: string
  filters: Array<Filter | { or: string }>
  order: Array<{ col: string; ascending: boolean; nullsFirst?: boolean }>
  values?: unknown
  count?: 'exact' | 'planned' | 'estimated'
  head?: boolean
  returning?: boolean
  onConflict?: string
  ignoreDuplicates?: boolean
  limit?: number
  offset?: number
  single?: boolean
  maybeSingle?: boolean
}
type CountOpt = { count?: QueryRequest['count'] }

/**
 * A query against one table. `Row` is the row shape (the table's columns, or the
 * joined shape set with `.returns<T>()`), `Result` what `data` holds.
 */
class Query<Row, Result = Row[]> implements PromiseLike<DbResult<Result>> {
  client: BackendClient
  req: QueryRequest
  _throw = false

  constructor(client: BackendClient, table: string) {
    this.client = client
    this.req = { table, action: 'select', select: '*', filters: [], order: [] }
  }

  select(columns = '*', { count, head }: CountOpt & { head?: boolean } = {}): Query<Row, Row[]> {
    if (this.req.action === 'select') this.req.select = columns
    else { this.req.returning = true; this.req.select = columns }
    if (count) this.req.count = count
    if (head) this.req.head = true
    return this as unknown as Query<Row, Row[]>
  }

  insert(values: Partial<Row> | Partial<Row>[], { count }: CountOpt = {}): Query<Row, null> {
    Object.assign(this.req, { action: 'insert', values, count })
    return this as unknown as Query<Row, null>
  }
  upsert(values: Partial<Row> | Partial<Row>[], { onConflict, ignoreDuplicates, count }: CountOpt & { onConflict?: string; ignoreDuplicates?: boolean } = {}): Query<Row, null> {
    Object.assign(this.req, { action: 'upsert', values, onConflict, ignoreDuplicates, count })
    return this as unknown as Query<Row, null>
  }
  update(values: Partial<Row>, { count }: CountOpt = {}): Query<Row, null> {
    Object.assign(this.req, { action: 'update', values, count })
    return this as unknown as Query<Row, null>
  }
  delete({ count }: CountOpt = {}): Query<Row, null> {
    Object.assign(this.req, { action: 'delete', count })
    return this as unknown as Query<Row, null>
  }

  _f(col: string, op: FilterOp, value: FilterValue, negate = false) { this.req.filters.push({ col, op, value, negate }); return this }
  eq(c: string, v: FilterValue) { return this._f(c, 'eq', v) }
  neq(c: string, v: FilterValue) { return this._f(c, 'neq', v) }
  gt(c: string, v: FilterValue) { return this._f(c, 'gt', v) }
  gte(c: string, v: FilterValue) { return this._f(c, 'gte', v) }
  lt(c: string, v: FilterValue) { return this._f(c, 'lt', v) }
  lte(c: string, v: FilterValue) { return this._f(c, 'lte', v) }
  like(c: string, v: string) { return this._f(c, 'like', v) }
  ilike(c: string, v: string) { return this._f(c, 'ilike', v) }
  is(c: string, v: boolean | null) { return this._f(c, 'is', v === null ? 'null' : String(v)) }
  in(c: string, values: ReadonlyArray<string | number>) { return this._f(c, 'in', values) }
  contains(c: string, v: FilterValue) { return this._f(c, 'cs', v) }
  containedBy(c: string, v: FilterValue) { return this._f(c, 'cd', v) }
  overlaps(c: string, v: FilterValue) { return this._f(c, 'ov', v) }
  match(obj: Record<string, FilterValue>) { Object.entries(obj).forEach(([c, v]) => this._f(c, 'eq', v)); return this }
  not(c: string, op: FilterOp, v: FilterValue) { return this._f(c, op, v, true) }
  or(expr: string) { this.req.filters.push({ or: expr }); return this }
  filter(c: string, op: string, v: FilterValue) {
    if (op.startsWith('not.')) return this._f(c, op.slice(4), v, true)
    return this._f(c, op, v)
  }
  order(col: string, { ascending = true, nullsFirst }: { ascending?: boolean; nullsFirst?: boolean } = {}) { this.req.order.push({ col, ascending, nullsFirst }); return this }
  limit(n: number) { this.req.limit = n; return this }
  range(from: number, to: number) { this.req.offset = from; this.req.limit = to - from + 1; return this }
  single(): Query<Row, Row> { this.req.single = true; return this as unknown as Query<Row, Row> }
  maybeSingle(): Query<Row, Row | null> { this.req.maybeSingle = true; return this as unknown as Query<Row, Row | null> }
  /** Declare the row shape of a select with joins (no runtime effect). */
  returns<R>(): Query<R, R[]> { return this as unknown as Query<R, R[]> }
  throwOnError() { this._throw = true; return this }

  async _run(): Promise<DbResult<Result>> {
    const out = await this.client._post<Result>('/rest/v1/query', this.req)
    if (out.error && this._throw) throw out.error
    return out
  }

  then<A = DbResult<Result>, B = never>(
    resolve?: ((value: DbResult<Result>) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this._run().then(resolve, reject)
  }
}

class RpcCall<T> implements PromiseLike<DbResult<T>> {
  client: BackendClient
  fn: string
  args: Record<string, unknown>
  mode: 'single' | 'maybe' | null = null
  constructor(client: BackendClient, fn: string, args?: Record<string, unknown>) { this.client = client; this.fn = fn; this.args = args || {} }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  async _run(): Promise<DbResult<T>> {
    const out = await this.client._post<T | T[]>(`/rest/v1/rpc/${encodeURIComponent(this.fn)}`, this.args)
    if (!out.error && this.mode && Array.isArray(out.data)) {
      if (out.data.length > 1 || (this.mode === 'single' && out.data.length === 0)) {
        return { data: null, error: makeError({ message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, 406), status: 406 }
      }
      return { ...out, data: (out.data[0] ?? null) as T }
    }
    return out as DbResult<T>
  }
  then<A = DbResult<T>, B = never>(
    resolve?: ((value: DbResult<T>) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this._run().then(resolve, reject)
  }
}

/* ───────────────────────── storage ───────────────────────── */

type SignedUrlRow = { path: string; signedUrl: string | null; error: string | null }

class Bucket {
  client: BackendClient
  bucket: string
  constructor(client: BackendClient, bucket: string) { this.client = client; this.bucket = bucket }

  async upload(path: string, file: Blob, { upsert = false, contentType }: { upsert?: boolean; contentType?: string; cacheControl?: string } = {}) {
    const headers = { 'Content-Type': contentType || file?.type || 'application/octet-stream', 'x-upsert': String(!!upsert) }
    const out = await this.client._fetch<{ id?: string; fullPath?: string; Key?: string }>(`/storage/v1/object/${this.bucket}/${path}`, { method: 'POST', headers, body: file })
    return out.error ? { data: null, error: out.error } : { data: { path, id: out.data?.id, fullPath: out.data?.fullPath }, error: null }
  }

  async remove(paths: string[]) {
    return this.client._fetch<unknown>(`/storage/v1/object/${this.bucket}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }),
    })
  }

  async createSignedUrls(paths: string[], expiresIn: number) {
    return this.client._fetch<SignedUrlRow[]>(`/storage/v1/object/sign/${this.bucket}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, expiresIn }),
    })
  }

  async createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string | null }; error: null } | { data: null; error: ApiError }> {
    const { data, error } = await this.createSignedUrls([path], expiresIn)
    if (error) return { data: null, error }
    const row = data?.[0]
    if (!row || row.error) return { data: null, error: makeError({ message: row?.error || 'Object not found' }, 404) }
    return { data: { signedUrl: row.signedUrl }, error: null }
  }
}

/* ───────────────────────── realtime ───────────────────────── */

export type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'
export interface ChangeFilter { event?: ChangeEvent; schema?: string; table: DbTableName; filter?: string }
/** A realtime row change (new row for INSERT/UPDATE, old row for UPDATE/DELETE). */
export interface ChangePayload<Row = Record<string, Json>> {
  eventType: Exclude<ChangeEvent, '*'>
  table: string
  schema: string
  new: Row | null
  old: Partial<Row> | null
  commit_timestamp?: string
}
export type ChannelStatus = 'SUBSCRIBED' | 'CLOSED'
interface Binding { id: string; filter: ChangeFilter; callback: (payload: ChangePayload<never>) => void }

export class Channel {
  rt: Realtime
  name: string
  bindings: Binding[] = []
  statusCb: ((status: ChannelStatus) => void) | null = null
  _announced = false
  constructor(rt: Realtime, name: string) { this.rt = rt; this.name = name }
  on<K extends DbTableName>(type: 'postgres_changes', filter: ChangeFilter & { table: K }, callback: (payload: ChangePayload<DbTables[K]>) => void) {
    if (type === 'postgres_changes') this.bindings.push({ id: `${this.name}:${this.bindings.length}:${Math.random().toString(36).slice(2, 8)}`, filter, callback: callback as Binding['callback'] })
    return this
  }
  subscribe(statusCb?: (status: ChannelStatus) => void) { this.statusCb = statusCb || null; this.rt._add(this); return this }
  unsubscribe() { this.rt._remove(this); return Promise.resolve('ok') }
}

type ServerMessage =
  | { type: 'change'; id: string; payload: ChangePayload<never> }
  | { type: 'subscribed'; id: string }
  | { type: string; id?: string }

class Realtime {
  client: BackendClient
  channels = new Set<Channel>()
  byId = new Map<string, { ch: Channel; binding: Binding; acked: boolean }>()
  ws: WebSocket | null = null
  backoff = 500
  closing = false
  constructor(client: BackendClient) { this.client = client }

  _url(token: string | null) {
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
    ws.onmessage = (ev: MessageEvent<string>) => {
      let msg: ServerMessage
      try { msg = JSON.parse(ev.data) as ServerMessage } catch { return }
      if (msg.type === 'change' && 'payload' in msg) {
        const b = this.byId.get(msg.id)
        if (b) { try { b.binding.callback(msg.payload) } catch (err) { console.error(err) } }
      } else if (msg.type === 'subscribed' && msg.id) {
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

  _sendSubs(ch: Channel) {
    if (!this.ws || this.ws.readyState !== 1) return
    for (const b of ch.bindings) {
      const f = b.filter
      this.byId.set(b.id, { ch, binding: b, acked: false })
      this.ws.send(JSON.stringify({ type: 'subscribe', id: b.id, table: f.table, event: f.event || '*', filter: f.filter || '' }))
    }
    if (!ch.bindings.length) ch.statusCb?.('SUBSCRIBED')
  }

  _add(ch: Channel) {
    this.channels.add(ch)
    if (this.ws && this.ws.readyState === 1) this._sendSubs(ch)
    else void this._connect()
  }

  _remove(ch: Channel) {
    if (!this.channels.delete(ch)) return
    for (const b of ch.bindings) {
      this.byId.delete(b.id)
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'unsubscribe', id: b.id }))
    }
    ch.statusCb?.('CLOSED')
    if (!this.channels.size && this.ws) { this.closing = true; this.ws.close(); this.ws = null; this.closing = false }
  }

  setToken(token: string | null) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'auth', token: token || '' }))
  }
}

/* ───────────────────────── client ───────────────────────── */

type FetchResult<T> = { data: T | null; error: null; status: number } | { data: null; error: ApiError; status: number }
type Envelope<T> = { data?: T; count?: number | null } | null

class BackendClient {
  realtime: Realtime
  auth: Auth
  storage: { from: (bucket: string) => Bucket }
  functions: { invoke: <T = unknown>(name: string, opts?: { body?: unknown }) => Promise<DbResult<T>> }

  constructor() {
    this.realtime = new Realtime(this)
    this.auth = new Auth(this)
    this.storage = { from: (bucket) => new Bucket(this, bucket) }
    this.functions = { invoke: <T,>(name: string, { body }: { body?: unknown } = {}) => this._post<T>(`/functions/v1/${name}`, body || {}, true) }
  }

  _onToken(token: string | null) { this.realtime?.setToken(token) }

  async _fetch<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, retried = false): Promise<FetchResult<T>> {
    const headers: Record<string, string> = { ...(init.headers || {}) }
    const token = await this.auth.accessToken()
    if (token) headers.Authorization = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(`${API_URL}${path}`, { ...init, headers })
    } catch (err) {
      return { data: null, error: makeError({ message: errMessage(err) }, 0), status: 0 }
    }
    const body = await parse<T & ErrorBody>(res)
    if (res.status === 401 && token && !retried && /jwt/i.test((body as ErrorBody)?.message || '')) {
      await this.auth._refresh()
      return this._fetch<T>(path, init, true)
    }
    if (!res.ok) return { data: null, error: makeError(body as ErrorBody, res.status), status: res.status }
    return { data: body as T | null, error: null, status: res.status }
  }

  /** POST JSON. Data endpoints wrap rows as { data, count }; `raw` returns the body as is. */
  async _post<T>(path: string, body: unknown, raw = false): Promise<DbResult<T>> {
    const out = await this._fetch<T | Envelope<T>>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    if (out.error) return { data: null, error: out.error, status: out.status }
    if (raw) return { data: out.data as T, error: null, status: out.status }
    const env = out.data as Envelope<T>
    return { data: (env?.data ?? null) as T, count: env?.count ?? null, error: null, status: out.status }
  }

  from<K extends DbTableName>(table: K): Query<DbTables[K]> { return new Query<DbTables[K]>(this, table) }
  /** Call a database function; `T` is its result. */
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>) { return new RpcCall<T>(this, fn, args) }
  channel(name: string) { return new Channel(this.realtime, name) }
  removeChannel(ch: Channel | null | undefined) { return ch?.unsubscribe() }
  removeAllChannels() { [...this.realtime.channels].forEach((c) => { void c.unsubscribe() }) }
}

export const sb = new BackendClient()
export const API_BASE_URL = API_URL
export type { Query, RpcCall, Bucket, BackendClient }
