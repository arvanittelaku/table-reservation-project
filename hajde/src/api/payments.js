import { sb } from '../supabaseClient'

function throwAuthError(error) {
  const e = new Error(error?.message || String(error))
  if (error?.code) e.code = error.code
  throw e
}

/**
 * Start a seat payment for a paid table (not rides).
 *
 * For now this only records the intent locally. The real provider redirect
 * (TEB / Raiffeisen / Paddle) will be plugged in below when ready.
 *
 * IMPORTANT: confirm_paid_seat must NEVER be called from the client.
 * The payment provider webhook (Edge Function) is the only place that
 * should call confirm_paid_seat after a successful charge.
 *
 * @param {string} tableId
 * @param {number} amountCents — amount in euro cents (e.g. 200 = €2.00)
 * @returns {{ ok: boolean, message: string, intent: object }}
 */
export async function startPayment(tableId, amountCents) {
  const { data: auth, error: authError } = await sb.auth.getUser()
  if (authError || !auth.user) {
    throw new Error('You must be signed in to pay')
  }

  const intent = {
    table_id: tableId,
    user_id: auth.user.id,
    amount_cents: amountCents,
    currency: 'EUR',
    created_at: new Date().toISOString(),
  }

  // Intent only — do not mark the seat confirmed here
  console.info('[ejabashkohu] payment intent', intent)

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * PAYMENT PROVIDER INTEGRATION POINT
   * ─────────────────────────────────────────────────────────────────────────
   *
   * When ready, replace the stub below with a real checkout redirect:
   *
   * 1. Call your Edge Function / backend to create a checkout session, e.g.:
   *
   *      const { data, error } = await sb.functions.invoke('create-checkout', {
   *        body: { table_id: tableId, amount_cents: amountCents },
   *      })
   *      if (error) throw error
   *
   * 2. Redirect the browser to the provider checkout URL:
   *
   *      // TEB Bank / Raiffeisen e-commerce
   *      window.location.href = data.checkout_url
   *
   *      // or Paddle
   *      // Paddle.Checkout.open({ transactionId: data.transaction_id })
   *
   * 3. Configure the provider webhook to hit an Edge Function that:
   *      - verifies the signature
   *      - inserts/updates the payments row as 'paid'
   *      - calls the confirm_paid_seat RPC
   *
   *    Do NOT call confirm_paid_seat from this client function.
   *
   * Providers considered: TEB, Raiffeisen, Paddle.
   * ─────────────────────────────────────────────────────────────────────────
   */

  return {
    ok: false,
    message: 'Payment provider integration pending',
    intent,
  }
}
