import { callRpc } from './rpc'
import { errorCode, errorMessage } from '../lib/errors'
import type { MyPlan, MyWednesday, SubscriptionOrderRow } from '../types/db'

export const plansApi = {
  mine: () => callRpc<MyPlan>('my_plan'),
  setHomeCity: (city: string) => callRpc<null>('set_home_city', { p_city: city }),
  requestPremium: (planId: string) => callRpc<Pick<SubscriptionOrderRow, 'id' | 'code' | 'plan_id' | 'amount_cents'>>('request_premium', { p_plan: planId }),
  cancelOrder: () => callRpc<null>('cancel_premium_order'),
  signupWednesday: (city: string, langs: string[] | null | undefined) => callRpc<MyWednesday>('signup_wednesday', { p_city: city, p_langs: langs || [] }),
  cancelWednesday: () => callRpc<null>('cancel_wednesday_signup'),
  myWednesday: () => callRpc<MyWednesday>('my_wednesday'),
}

/** True when the plans migration is not applied yet (keeps the app usable). */
export const isMissingFn = (err: unknown): boolean => errorCode(err) === 'PGRST202' || /Could not find the function/i.test(errorMessage(err))
