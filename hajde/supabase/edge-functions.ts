// ═══════════════════════════════════════════════════════════════════
//  EJABASHKOHU — EDGE FUNCTION NOTES
//
//  Përkthimi NUK përdor më Edge Function.
//  Klienti thërret LibreTranslate (+ MyMemory fallback) nga:
//    src/api/translate.js
//
//  Mbetet për deploy: payment-webhook (skelet më poshtë) dhe notify-email.
// ═══════════════════════════════════════════════════════════════════

/* ═══════════════════════════════════════════════════════════════════
   EDGE FUNCTION: payment-webhook
   Vendoset në: supabase/functions/payment-webhook/index.ts
   Sekretet:    PAYMENT_WEBHOOK_SECRET (nga procesori), SERVICE_ROLE_KEY

   Rrjedha e sigurt e pagesës:
   1. Klienti nis pagesën te procesori (TEB / Raiffeisen / Paddle / PayPal)
      me metadata: { user_id, table_id }.
   2. Procesori e tërheq pagesën dhe thërret KËTË webhook me nënshkrim.
   3. Ne verifikojmë nënshkrimin (që të mos falsifikohet), pastaj thërrasim
      RPC-në confirm_paid_seat me SERVICE ROLE — e vetmja rrugë që dikush
      bëhet anëtar me pagesë. Klienti KURRË s'e konfirmon veten.

   Skeleti (përshtatet sipas procesorit konkret):

   import { createClient } from "npm:@supabase/supabase-js@2";

   Deno.serve(async (req) => {
     const signature = req.headers.get("x-signature") ?? "";
     const raw = await req.text();
     if (!verifySignature(raw, signature, Deno.env.get("PAYMENT_WEBHOOK_SECRET")!)) {
       return new Response("Nënshkrim i pavlefshëm", { status: 401 });
     }
     const event = JSON.parse(raw);
     if (event.status !== "completed") return new Response("ok");

     const admin = createClient(
       Deno.env.get("SUPABASE_URL")!,
       Deno.env.get("SERVICE_ROLE_KEY")!,   // vetëm këtu, kurrë në klient
     );
     const { data, error } = await admin.rpc("confirm_paid_seat", {
       p_user: event.metadata.user_id,
       p_table: event.metadata.table_id,
       p_amount_cents: event.amount_cents,
       p_provider: event.provider,
       p_provider_ref: event.transaction_id,
     });
     if (error) return new Response(error.message, { status: 400 });
     return new Response(JSON.stringify({ ticket: data }), { status: 200 });
   });
   ═══════════════════════════════════════════════════════════════════ */
