-- ═══════════════════════════════════════════════════════════════════
--  HAJDE! — NJOFTIMET ME EMAIL (pjesa reale e backend-it)
--  Ekzekutohet PAS schema.sql. Dërgon email te nikoqiri sa herë
--  që dikush kërkon t'i bashkohet tavolinës — edhe kur aplikacioni
--  s'është i hapur. Përdor pg_net + Edge Function + Resend.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Aktivizo pg_net (Dashboard → Database → Extensions → pg_net → Enable)
create extension if not exists pg_net;

-- 2) Trigger-i: kërkesë e re → thirr Edge Function-in notify-email
create or replace function public.email_on_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_title text; v_name text;
begin
  select host_id, title into v_host, v_title from public.tables where id = new.table_id;
  select first_name || ' ' || last_name into v_name from public.profiles where id = new.user_id;

  perform net.http_post(
    url := 'https://PROJEKTI-YT.supabase.co/functions/v1/notify-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_key', true)
    ),
    body := jsonb_build_object(
      'host_id', v_host,
      'requester_name', v_name,
      'table_title', v_title
    )
  );
  return new;
end $$;

create trigger trg_email_request after insert on public.requests
  for each row execute function public.email_on_request();

-- 3) Vendos çelësin si cilësim (një herë, si superuser në SQL Editor):
-- alter database postgres set app.service_key = 'SERVICE_ROLE_KEY_KETU';


/* ═══════════════════════════════════════════════════════════════════
   EDGE FUNCTION: notify-email
   Vendoset në: supabase/functions/notify-email/index.ts
   Sekretet:    supabase secrets set RESEND_API_KEY=re_...
   (Resend.com — 3,000 email falas/muaj; alternativa: Postmark, SES)

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  // Pranohet vetëm nga databaza (service role) — jo nga klientët
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(Deno.env.get("SERVICE_ROLE_KEY")!)) {
    return new Response("E ndaluar", { status: 401 });
  }

  const { host_id, requester_name, table_title } = await req.json();

  // Merr email-in e nikoqirit nga Auth (i verifikuar në regjistrim)
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY")!,
  );
  const { data: { user } } = await admin.auth.admin.getUserById(host_id);
  if (!user?.email) return new Response("Pa email", { status: 200 });

  // Dërgo email-in me Resend
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "ejaBashkohu <njoftime@ejabashkohu.app>",
      to: user.email,
      subject: `${requester_name} kërkon t'i bashkohet "${table_title}"`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;background:#FAFAF8;border-radius:16px;padding:24px">
          <h2 style="color:#1A1A2E;margin:0 0 4px">eja<span style="color:#FF6B35">Bashkohu</span></h2>
          <p style="font-size:16px;color:#1A1A2E"><b>${requester_name}</b> kërkon t'i bashkohet tavolinës tënde
          <b>"${table_title}"</b>.</p>
          <p style="color:#6B7280">Hap aplikacionin për ta parë profilin me foto e moshë — dhe vendos ti.</p>
          <a href="https://ejabashkohu.com" style="display:inline-block;background:#FF6B35;color:#fff;
             padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:bold">Shiko kërkesën →</a>
          <p style="font-size:11px;color:#9A8F73;margin-top:18px">Merr këtë email sepse ke tavolinë të hapur në ejaBashkohu.
          Mund t'i fikësh njoftimet me email te Cilësimet.</p>
        </div>`,
    }),
  });

  return new Response("ok", { status: 200 });
});
   ═══════════════════════════════════════════════════════════════════ */

-- Shënim: e njëjta rrugë përdoret për email-e të tjera kritike —
-- "u aprovove", "u lirua vend nga lista e pritjes", "restoranti u zbulua".
-- Mjafton të shtohen trigger-a analogë mbi requests(update) dhe waitlist.
