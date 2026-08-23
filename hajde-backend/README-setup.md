# HAJDE! — Backend-i i plotë: Udhëzuesi i ngritjes
*Nga zero deri në funksionim · Korrik 2026*

Ky paket përmban gjithçka që i duhet Hajde!-s për të kaluar nga prototipi te
aplikacioni i vërtetë me të dhëna të përhershme e të sigurta.

## Përmbajtja e paketës

| Skedari | Çka bën |
|---|---|
| `schema.sql` | 16 tabelat, triggerat, RPC-të dhe Row Level Security për gjithçka |
| `storage.sql` | Bucket-i privat i fotove me politikat e qasjes |
| `edge-functions.ts` | Përkthimi (çelësi i fshehur në server) + webhook-u i pagesës |
| `api.js` | Shtresa e gatshme e lidhjes për frontend-in — çdo veprim i aplikacionit |

---

## HAPI 1 — Krijo projektin (5 min)

1. Shko te **supabase.com** → *New project* (plani falas mjafton për fillim)
2. Emri: `hajde`, rajoni: **Frankfurt (eu-central-1)** — më i afërti me Kosovën
3. Ruaje **fjalëkalimin e databazës** diku të sigurt
4. Nga *Settings → API* kopjo: `Project URL` dhe `anon public key`
   (këto futen te `api.js` — janë publike, siguria vjen nga RLS)

## HAPI 2 — Ekzekuto skemën (2 min)

1. *SQL Editor* → *New query* → ngjit **të gjithë** `schema.sql` → *Run*
2. Po aty ekzekuto edhe `storage.sql`
3. Kontrollo te *Table Editor*: duhet të shohësh 16 tabelat

## HAPI 3 — Konfiguro Auth (3 min)

Te *Authentication → Providers*:
- **Email**: aktiv, me *Confirm email* të ndezur (verifikim i detyruar)
- Opsionale: **Google** dhe **Apple** login (i shpejtë për turistët)
- Te *Auth → URL Configuration* shto domenin tënd (p.sh. `https://hajde-ks.netlify.app`)

## HAPI 4 — Edge Functions (10 min)

```bash
npm install -g supabase
supabase login
supabase init && supabase link --project-ref PROJEKTI-YT

# krijo funksionet nga edge-functions.ts
supabase functions new payment-webhook  # ngjit skeletin e pagesës

# sekretet — KURRË në kod, vetëm këtu:
supabase secrets set PAYMENT_WEBHOOK_SECRET=...

supabase functions deploy payment-webhook
```
# Përkthimi: klient → LibreTranslate / MyMemory (pa Edge Function, pa çelës)

## HAPI 5 — Lidhe frontend-in (30 min)

1. `npm install @supabase/supabase-js`
2. Kopjo `api.js` në projekt dhe fut URL + anon key
3. Zëvendëso simulimet e prototipit me thirrjet reale:

| Në prototip (v11/web) | Bëhet |
|---|---|
| `setTables([...])` në memorie | `listTables({ city, category })` |
| Aprovimi i simuluar pas 4 sek | `subscribeRequests()` — kërkesat vijnë LIVE |
| `pushNotif(...)` lokal | `subscribeNotifications()` — nga databaza, live |
| Chat në memorie | `sendMessage()` + `subscribeMessages()` |
| Pagesa e simuluar | `startPayment()` → procesori → webhook → bileta |
| Fotoja në memorie | `uploadAvatar()` + `avatarUrl()` (URL që skadon) |
| Përkthimi | `translateText()` — LibreTranslate + MyMemory (pa çelës) |

## HAPI 6 — Verifikimi i fytyrës në server (opsional por i fortë)

Kontrolli në shfletues (v-web) mbetet për përvojën e shpejtë, por shto edhe
verifikimin që s'anashkalohet: një Edge Function `verify-face` që pas
`uploadAvatar` e kalon foton te **AWS Rekognition** (`DetectFaces`) ose
**Azure Face API** dhe vendos `photo_face_ok = true` në profil vetëm nëse
gjendet saktësisht një fytyrë. Në UI, profilet me `photo_face_ok = false`
shfaqen si "në pritje të verifikimit".

## HAPI 7 — Pagesat

1. Hap llogari biznesi te **TEB / Raiffeisen / ProCredit** (e-commerce) ose **Paddle**
2. Në checkout dërgo `metadata: { user_id, table_id }`
3. Vendos URL-në e webhook-ut: `https://PROJEKTI-YT.supabase.co/functions/v1/payment-webhook`
4. Webhook-u verifikon nënshkrimin → thërret `confirm_paid_seat` → anëtarësia + bileta + njoftimi
5. **Asnjë numër kartele nuk prek serverin tënd** — vetëm procesorin PCI-DSS

---

## Pse është e sigurt kjo arkitekturë

- **Fjalëkalimet**: bcrypt hash te Supabase Auth — të palexueshme edhe për ty
- **RLS në çdo tabelë**: chat-in e lexon vetëm anëtari, kërkesat vetëm nikoqiri,
  shijet vetëm pronari, raportet vetëm ekipi — e zbaton vetë databaza
- **18+ i detyruar nga databaza**: `check (age between 18 and 99)` — i pakapërcyeshëm
- **Fotot private**: bucket jo-publik + URL të nënshkruara që skadojnë pas 1 ore
- **Pagesat**: konfirmimi vetëm nga webhook-u me service role — klienti s'e "bën veten" anëtar
- **Bllokimet në nivel databaze**: tavolinat e të bllokuarve as nuk kthehen nga query
- **Çelësat sekretë** (Anthropic, pagesa): vetëm në Edge Functions, kurrë në klient
- **HTTPS + AES-256 në disk + backup ditor**: të përfshira nga Supabase
- **E drejta e fshirjes**: `on delete cascade` kudo — fshirja e llogarisë pastron gjithçka

## Kostoja

Falas deri ~50,000 përdorues aktivë/muaj → pastaj ~25 $/muaj (Pro).
Edge Functions: 500,000 thirrje falas/muaj — mjafton për shumë kohë përkthimesh.

*Suksese me lansimin! 🚀*
