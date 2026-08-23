// Supabase Edge Function: check-email-domain
// Deploy: supabase functions deploy check-email-domain --project-ref upxxfhvgbmddhyebaiug
// Checks MX records only — does NOT verify a specific mailbox exists.

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
    const { email } = await req.json()
    const domain = typeof email === 'string' ? email.split('@')[1]?.trim().toLowerCase() : ''

    if (!domain || !/^[^\s@]+\.[^\s@]+$/.test(domain)) {
      return json({ valid: false, reason: 'invalid_domain' })
    }

    try {
      const mxRecords = await Deno.resolveDns(domain, 'MX')
      const valid = Array.isArray(mxRecords) && mxRecords.length > 0
      return json({ valid, domain, checked: 'mx' })
    } catch {
      // Some domains accept mail via A/AAAA when no MX is published — fallback once.
      try {
        const aRecords = await Deno.resolveDns(domain, 'A')
        if (Array.isArray(aRecords) && aRecords.length > 0) {
          return json({ valid: true, domain, checked: 'a_fallback' })
        }
      } catch {
        /* ignore */
      }
      return json({ valid: false, domain, reason: 'no_mx' })
    }
  } catch (err) {
    console.error('[check-email-domain]', err)
    return json({ valid: false, reason: 'bad_request' }, 400)
  }
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
