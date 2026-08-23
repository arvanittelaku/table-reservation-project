import nodemailer from 'npm:nodemailer@^6.9.16'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FROM_DEFAULT = 'ejaBashkohu <njoftime@ejabashkohu.app>'

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  auth: { user: string; pass: string }
  from: string
}

function smtpConfigFromEnv(): SmtpConfig | null {
  const host =
    Deno.env.get('SMTP_HOSTNAME') ||
    Deno.env.get('SMTP_HOST') ||
    Deno.env.get('GOTRUE_SMTP_HOST') ||
    'smtp.gmail.com'
  const port = Number(
    Deno.env.get('SMTP_PORT') ||
      Deno.env.get('GOTRUE_SMTP_PORT') ||
      '465',
  )
  const secure =
    (Deno.env.get('SMTP_SECURE') ||
      (port === 465 ? 'true' : 'false')).toLowerCase() === 'true'
  const user =
    Deno.env.get('SMTP_USERNAME') ||
    Deno.env.get('SMTP_USER') ||
    Deno.env.get('GOTRUE_SMTP_USER') ||
    Deno.env.get('GOTRUE_SMTP_ADMIN_EMAIL') ||
    ''
  const pass =
    Deno.env.get('SMTP_PASSWORD') ||
    Deno.env.get('SMTP_PASS') ||
    Deno.env.get('GOTRUE_SMTP_PASS') ||
    ''

  if (!user || !pass) return null

  return {
    host,
    port,
    secure,
    auth: { user, pass },
    from:
      Deno.env.get('SMTP_FROM') ||
      Deno.env.get('SMTP_SENDER') ||
      FROM_DEFAULT,
  }
}

async function smtpConfigFromVault(
  admin: SupabaseClient,
): Promise<SmtpConfig | null> {
  const { data, error } = await admin.rpc('get_smtp_config')
  if (error || !data) return null

  const cfg = data as Record<string, string>
  const user = cfg.user || cfg.username || ''
  const pass = cfg.pass || cfg.password || ''
  if (!user || !pass) return null

  const port = Number(cfg.port || '465')
  return {
    host: cfg.host || 'smtp.gmail.com',
    port,
    secure: String(cfg.secure ?? (port === 465)).toLowerCase() === 'true',
    auth: { user, pass },
    from: cfg.from || FROM_DEFAULT,
  }
}

async function resolveSmtpConfig(
  admin?: SupabaseClient,
): Promise<SmtpConfig> {
  const fromEnv = smtpConfigFromEnv()
  if (fromEnv) return fromEnv

  if (admin) {
    const fromVault = await smtpConfigFromVault(admin)
    if (fromVault) return fromVault
  }

  throw new Error('SMTP credentials are not configured')
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null
let transportKey = ''

function getTransport(cfg: SmtpConfig) {
  const key = `${cfg.host}:${cfg.port}:${cfg.auth.user}`
  if (!transport || transportKey !== key) {
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.auth,
    })
    transportKey = key
  }
  return transport
}

export function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
  admin?: SupabaseClient
}) {
  const cfg = await resolveSmtpConfig(opts.admin)
  await new Promise<void>((resolve, reject) => {
    getTransport(cfg).sendMail(
      {
        from: cfg.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html:
          opts.html ??
          `<p style="font-family:sans-serif;font-size:15px;line-height:1.5">${escapeHtml(opts.text).replace(/\n/g, '<br>')}</p>
           <p style="font-family:sans-serif;font-size:12px;color:#888">ejaBashkohu, table sharing in Kosovo</p>`,
      },
      (error) => {
        if (error) reject(error)
        else resolve()
      },
    )
  })
}
