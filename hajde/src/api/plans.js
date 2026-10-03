import { sb } from '../supabaseClient'

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args)
  if (error) {
    const e = new Error(error.message || String(error))
    e.code = error.code
    throw e
  }
  return data
}

export const plansApi = {
  mine: () => rpc('my_plan'),
  setHomeCity: (city) => rpc('set_home_city', { p_city: city }),
  requestPremium: (planId) => rpc('request_premium', { p_plan: planId }),
  cancelOrder: () => rpc('cancel_premium_order'),
  signupWednesday: (city, langs) => rpc('signup_wednesday', { p_city: city, p_langs: langs || [] }),
  cancelWednesday: () => rpc('cancel_wednesday_signup'),
  myWednesday: () => rpc('my_wednesday'),
}

/** True when the plans migration is not applied yet (keeps the app usable). */
export const isMissingFn = (err) => err?.code === 'PGRST202' || /Could not find the function/i.test(String(err?.message || ''))
