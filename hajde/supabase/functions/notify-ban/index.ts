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
    const auth = req.headers.get('Authorization') ?? ''
    const serviceKey =
      Deno.env.get('SERVICE_ROLE_KEY') ||
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
      ''
    if (!serviceKey || !auth.includes(serviceKey)) {
      return new Response('E ndaluar', { status: 401, headers: corsHeaders })
    }

    const { user_id, reason, ban_count } = await req.json()
    if (!user_id || !reason) {
      return json({ error: 'user_id and reason are required' }, 400)
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      serviceKey,
    )

    const { data: { user } } = await admin.auth.admin.getUserById(user_id)
    if (!user?.email) {
      return json({ skipped: true, reason: 'no email' })
    }

    const count = Number(ban_count) || 1
    const subject = 'ejaBashkohu: Njoftim pezullimi'
    const body =
      `Llogaria juaj në ejaBashkohu u pezullua.\n\n` +
      `Arsyeja: ${reason}\n` +
      `Pezullim ${count}/3.\n\n` +
      (count >= 3
        ? 'Ky ishte pezullimi i tretë. Llogaria juaj u fshi përgjithmonë.'
        : 'Pezullimi i tretë do të rezultojë në fshirje të përhershme të llogarisë.')

    try {
      await sendEmail({
        to: user.email,
        subject,
        text: body,
        html: `<p style="font-family:sans-serif;font-size:15px;line-height:1.5">${escapeHtml(body).replace(/\n/g, '<br>')}</p>
               <p style="font-family:sans-serif;font-size:12px;color:#888">ejaBashkohu, table sharing in Kosovo</p>`,
        admin,
      })
    } catch (err) {
      const msg = err?.message ?? 'Unexpected error'
      if (msg.includes('SMTP credentials are not configured')) {
        console.warn('Ban email skipped — SMTP not configured yet')
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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
