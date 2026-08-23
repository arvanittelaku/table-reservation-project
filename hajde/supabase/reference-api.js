// ═══════════════════════════════════════════════════════════════════
//  HAJDE! — api.js: shtresa e lidhjes frontend ↔ backend
//  Çdo veprim i aplikacionit ka funksionin e vet të sigurt këtu.
//  Instalimi:  npm install @supabase/supabase-js
// ═══════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

// Këto dy vlera janë PUBLIKE (anon key) — siguria vjen nga RLS, jo nga fshehja e tyre.
const SUPABASE_URL = "https://PROJEKTI-YT.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ───────────── 1. LLOGARIA ───────────── */

export async function signUp({ email, password, firstName, lastName, age }) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { first_name: firstName, last_name: lastName, age } },
  });
  if (error) throw error;
  return data.user; // profili krijohet vetiu nga trigger-i në databazë
}

export const signIn = (email, password) =>
  sb.auth.signInWithPassword({ email, password });
export const signOut = () => sb.auth.signOut();
export const currentUser = async () => (await sb.auth.getUser()).data.user;

// E drejta e fshirjes (GDPR / Ligji i Kosovës): fshin gjithçka me cascade
export async function deleteMyAccount() {
  const { error } = await sb.functions.invoke("delete-account");
  if (error) throw error;
}

/* ───────────── 2. FOTOJA E PROFILIT (private + e verifikuar) ───────────── */

export async function uploadAvatar(file) {
  const user = await currentUser();
  const path = `${user.id}/avatar.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw error;
  await sb.from("profiles").update({ photo_path: path }).eq("id", user.id);
  return path;
}

// URL e nënshkruar që skadon pas 1 ore — asnjë foto me link të përhershëm
export async function avatarUrl(path) {
  if (!path) return null;
  const { data } = await sb.storage.from("avatars").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/* ───────────── 3. PROFILI I SHIJEVE + PËRPUTHJA ───────────── */

export const saveTasteProfile = async (answers) => {
  const user = await currentUser();
  return sb.from("taste_profiles").upsert({ user_id: user.id, ...answers, done: true });
};

export const myAffinity = async () => {
  const { data } = await sb.from("affinity").select("category, score");
  return Object.fromEntries((data ?? []).map((r) => [r.category, r.score]));
};

/* ───────────── 4. TAVOLINAT / VOZITJET / UDHËTIMET ───────────── */

export async function listTables({ city, category }) {
  let q = sb.from("tables")
    .select(`*, host:profiles!tables_host_id_fkey (id, first_name, last_name, age, photo_path, verified, rating, tables_hosted),
             memberships (user_id), requests (user_id, status)`)
    .eq("status", "open")
    .eq("city", city)
    .order("created_at", { ascending: false });
  if (category && category !== "all") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) throw error;
  return data; // RLS i fsheh vetiu tavolinat e të bllokuarve
}

export async function createTable(t) {
  const user = await currentUser();
  const { data, error } = await sb.from("tables")
    .insert({ ...t, host_id: user.id })
    .select().single();
  if (error) throw error;
  return data;
}

/* ───────────── 5. RRJEDHA: kërkesë → aprovim → konfirmim ───────────── */

export const requestJoin   = (tableId)   => sb.rpc("request_join",   { p_table: tableId });
export const approveRequest = (requestId) => sb.rpc("approve_request", { p_request: requestId });
export const rejectRequest  = (requestId) => sb.rpc("reject_request",  { p_request: requestId });
export const confirmFreeSeat = (tableId)  => sb.rpc("confirm_free_seat", { p_table: tableId }); // vozitjet
export const leaveTable     = (tableId)   => sb.rpc("leave_table",     { p_table: tableId });   // pa rimbursim

// Pagesa: klienti VETËM e nis te procesori me metadata — konfirmimin
// e bën webhook-u në server (shih edge-functions.ts). Këtu s'ka kartela.
export function startPayment({ tableId, amountCents }) {
  // shembull: ridrejtim te faqja e pagesës së procesorit
  // window.location.href = `https://pagesa.procesori.com/checkout?...&meta_table=${tableId}`;
}

/* ───────────── 6. LISTA E PRITJES ───────────── */

export const joinWaitlist = async (tableId) => {
  const user = await currentUser();
  return sb.from("waitlist").insert({ table_id: tableId, user_id: user.id });
};
export const leaveWaitlist = async (tableId) => {
  const user = await currentUser();
  return sb.from("waitlist").delete().match({ table_id: tableId, user_id: user.id });
};

/* ───────────── 7. CHAT-I — në kohë reale ───────────── */

export const sendMessage = async (tableId, body) => {
  const user = await currentUser();
  return sb.from("messages").insert({ table_id: tableId, sender_id: user.id, body });
};

export const loadMessages = (tableId) =>
  sb.from("messages")
    .select("*, sender:profiles!messages_sender_id_fkey (first_name, photo_path)")
    .eq("table_id", tableId)
    .order("created_at");

// Mesazhet e reja vijnë LIVE — kjo është "koha reale" e vërtetë
export function subscribeMessages(tableId, onNew) {
  return sb.channel(`chat-${tableId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `table_id=eq.${tableId}` },
      (payload) => onNew(payload.new))
    .subscribe();
}

/* ───────────── 8. NJOFTIMET — në kohë reale ───────────── */

export const loadNotifications = () =>
  sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);

export const markNotificationsRead = () =>
  sb.from("notifications").update({ read: true }).eq("read", false);

export function subscribeNotifications(userId, onNew) {
  return sb.channel(`notifs-${userId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => onNew(payload.new))
    .subscribe();
}

// Nikoqiri dëgjon kërkesat e reja për tavolinat e veta — live
export function subscribeRequests(tableId, onNew) {
  return sb.channel(`reqs-${tableId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "requests", filter: `table_id=eq.${tableId}` },
      (payload) => onNew(payload))
    .subscribe();
}

/* ───────────── 9. VLERËSIMET & LIDHJET ───────────── */

export const submitRating = async (tableId, stars, meetAgain) => {
  const user = await currentUser();
  return sb.from("ratings").insert({ table_id: tableId, rater_id: user.id, stars, meet_again: meetAgain });
};

export const pickConnections = async (tableId, pickedIds) => {
  const user = await currentUser();
  return sb.from("connection_picks").insert(
    pickedIds.map((id) => ({ table_id: tableId, picker_id: user.id, picked_id: id }))
  );
};

export const myConnections = async () => {
  const user = await currentUser();
  return sb.from("connections").select("*").or(`a.eq.${user.id},b.eq.${user.id}`);
};

/* ───────────── 10. SIGURIA ───────────── */

export const reportUser = async ({ reportedId, tableId, reason, details }) => {
  const user = await currentUser();
  return sb.from("reports").insert({ reporter_id: user.id, reported_id: reportedId, table_id: tableId, reason, details });
};

export const blockUser = async (blockedId) => {
  const user = await currentUser();
  return sb.from("blocks").insert({ blocker_id: user.id, blocked_id: blockedId });
};

/* ───────────── 11. PËRKTHIMI (LibreTranslate + MyMemory, pa çelës) ───────────── */

export { translateText as translate } from '../src/api/translate.js';

/* ───────────── 12. DISTINKTIVAT ───────────── */

export const awardBadge = async (badgeId) => {
  const user = await currentUser();
  return sb.from("badges").upsert({ user_id: user.id, badge_id: badgeId });
};
export const myBadges = () => sb.from("badges").select("badge_id, earned_at");
