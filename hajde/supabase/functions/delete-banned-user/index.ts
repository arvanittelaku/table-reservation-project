import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  const serviceKey =
    Deno.env.get('SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    ''
  if (!serviceKey || !auth.includes(serviceKey)) {
    return new Response('E ndaluar', { status: 401 })
  }

  const { user_id } = await req.json()
  if (!user_id) {
    return new Response('user_id required', { status: 400 })
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  )

  await admin.storage.from('avatars').remove([`${user_id}/avatar.jpg`])

  const { error } = await admin.auth.admin.deleteUser(user_id)
  if (error) return new Response(error.message, { status: 500 })
  return new Response('ok', { status: 200 })
})
