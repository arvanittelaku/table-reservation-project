// Supabase Edge Function: notify-email
// Deploy:  supabase functions deploy notify-email
// Secrets (once outbound email is ready):
//   supabase secrets set SMTP_HOSTNAME=... SMTP_PORT=465 SMTP_SECURE=true
//   SMTP_USERNAME=... SMTP_PASSWORD=... SMTP_FROM="ejaBashkohu <support@ejabashkohu.com>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { escapeHtml, sendEmail } from '../_shared/mailer.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const serviceKey =
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')

    // Allow service role (pg_net) or a valid user JWT
    const allowed =
      (serviceKey && authHeader.includes(serviceKey)) ||
      (serviceKey && token === serviceKey) ||
      (anonKey && token === anonKey) ||
      (await verifyUserJwt(authHeader))

    if (!allowed) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const payload = await req.json()
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceKey || anonKey,
    )

    let email = payload.email as string | undefined
    let title = payload.title || 'ejaBashkohu'
    let body = payload.body || payload.message || ''
    let prefUserId = payload.user_id as string | undefined

    // Join-request trigger payload (host_id + requester_name + table_title)
    if (!email && payload.host_id) {
      const { data: { user } } = await admin.auth.admin.getUserById(payload.host_id)
      if (!user?.email) {
        return json({ skipped: true, reason: 'no email' })
      }
      email = user.email
      prefUserId = payload.host_id
      const requester = payload.requester_name || 'Dikush'
      const tableTitle = payload.table_title || 'tavolinë'
      title = `${requester} kërkon t'i bashkohet "${tableTitle}"`
      body =
        `${requester} kërkon t'i bashkohet tavolinës tënde "${tableTitle}". ` +
        'Hap aplikacionin për ta parë profilin me foto e moshë, dhe vendos ti.'
    }

    if (!email) {
      return json({ error: 'email is required' }, 400)
    }

    // Double-check preference when user_id / host_id is provided
    if (prefUserId) {
      const { data: profile } = await admin
        .from('profiles')
        .select('user_preferences')
        .eq('id', prefUserId)
        .maybeSingle()

      const prefs = profile?.user_preferences
      if (
        prefs &&
        typeof prefs === 'object' &&
        prefs.email_notifications === false
      ) {
        return json({ skipped: true, reason: 'email_notifications off' })
      }
    }

    try {
      await sendEmail({
        to: email,
        subject: title,
        text: body,
        html: `<p style="font-family:sans-serif;font-size:15px;line-height:1.5">${escapeHtml(body)}</p>
               <p style="font-family:sans-serif;font-size:12px;color:#888">ejaBashkohu, table sharing in Kosovo</p>`,
        admin,
      })
    } catch (err) {
      const msg = err?.message ?? 'Unexpected error'
      if (msg.includes('SMTP credentials are not configured')) {
        return json({ ok: true, skipped: true, reason: 'smtp not configured' })
      }
      throw err
    }

    return json({ ok: true })
  } catch (err) {
    console.error(err)
    return json({ error: err?.message ?? 'Unexpected error' }, 500)
  }
})

async function verifyUserJwt(authHeader) {
  if (!authHeader) return false
  try {
    const client = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data, error } = await client.auth.getUser()
    return !error && !!data?.user
  } catch {
    return false
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
