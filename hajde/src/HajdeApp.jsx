import React from 'react'
import { useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import { useTables } from './hooks/useTables'
import { useNotifications } from './hooks/useNotifications'
import { useRequests } from './hooks/useRequests'
import { useChat } from './hooks/useChat'
import { createTable as apiCreateTable, saveTasteProfile } from './api/tables'
import {
  requestJoin as apiRequestJoin,
  confirmFreeSeat as apiConfirmFreeSeat,
  joinWaitlist as apiJoinWaitlist,
  leaveWaitlist as apiLeaveWaitlist,
  leaveTable as apiLeaveTable,
} from './api/requests'
import { uploadAvatar, saveAvatarToProfile, getAvatarUrl, clearAvatarCache } from './api/storage'
import { checkEmailDomain } from './api/checkEmail'
import { resendSignupConfirmation, signInWithProvider } from './api/auth'
import { isEmailFormatValid } from './lib/emailValidation'
import {
  savePendingRegistration,
  loadPendingRegistration,
  clearPendingRegistration,
  isOnboardingComplete,
  socialProviderOf,
} from './lib/onboardingPersist'
import { mapError, parseResetRateLimitSeconds } from './lib/errorMap'
import { parseAuthHashError, clearAuthHashFromUrl } from './lib/authHashError'
import { formatEventTime, formatBlockDate, isTableExpired } from './lib/formatEventTime'
import { localizeTableDescription } from './lib/localizeTableDescription'
import {
  buildEventDatetime,
  defaultEventSchedule,
  isFutureEventDatetime,
  isValidMapsLink,
  localDateInputValue,
  mapsUrlForTable,
  wednesdayMapsUrl,
} from './lib/eventSchedule'
import { nearestMunicipality } from './lib/geo'
import { buildWedQuizTableLangs } from './lib/wedQuizLangs'
import { WED_QUIZ } from './lib/wednesdayQuiz'
import { normalizeInterests, interestsForMatching } from './lib/tasteInterests'
import { photoErrorKey } from './lib/faceValidation'
import { sb } from './supabaseClient'
import PrivacyPolicy from './components/PrivacyPolicy'
import TermsOfService from './components/TermsOfService'
import LandingPage from './components/LandingPage'
import AdminPanel from './components/AdminPanel'
import Lessons from './components/lessons/Lessons.jsx'
import WhatsAppButton from './components/WhatsAppButton.jsx'
import { PlansSheet, HomeCityPicker } from './components/plans/Plans.jsx'
import { usePlan } from './hooks/usePlan'
import { plansApi } from './api/plans'
import { notifText, BADGE_LABEL_KEY } from './lib/notifText'
import { awardBadgeOnce } from './api/notifications'
import LanguageSwitcher from './components/LanguageSwitcher'
import PasswordInput from './components/PasswordInput'
import { useI18n } from './i18n/I18nContext.jsx'

const { useState, useRef, useEffect, useCallback, useMemo } = React;

/* Ikonat — glife të lehta pa varësi të jashtme */
const mkIcon = (glyph) => ({ size = 16, className = "", style = {}, title }) => (
  <span className={"emo " + className} title={title}
    style={{ fontSize: size, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }}>
    {glyph}
  </span>
);
const MapPin = mkIcon("⌖"), Clock = mkIcon("◷"), Users = mkIcon("◎"), Plus = mkIcon("＋"),
  Coffee = mkIcon("●"), Search = mkIcon("⌕"), X = mkIcon("✕"), Send = mkIcon("➤"),
  ChevronLeft = mkIcon("‹"), Globe = mkIcon("◎"), Sparkles = mkIcon("✦"), Check = mkIcon("✓"),
  Beer = mkIcon("●"), Mountain = mkIcon("▲"), Music = mkIcon("♪"), Gamepad2 = mkIcon("◆"),
  ShieldCheck = mkIcon("◈"), Star = mkIcon("★"), CreditCard = mkIcon("▣"), Wallet = mkIcon("◇"),
  Ticket = mkIcon("▤"), Dice5 = mkIcon("▣"), Lock = mkIcon("◼"), BadgeCheck = mkIcon("✓"),
  PartyPopper = mkIcon("✦"), Waves = mkIcon("~"), Home = mkIcon("⌂"), Dumbbell = mkIcon("▲"),
  UtensilsCrossed = mkIcon("◆"), Bell = mkIcon("●"), Camera = mkIcon("▣"),
  UserCheck = mkIcon("✔"), UserX = mkIcon("✖"), Hourglass = mkIcon("…"), Flag = mkIcon("⚑"),
  Share2 = mkIcon("⇪"), Award = mkIcon("★"), BellRing = mkIcon("●"), Car = mkIcon("►"),
  TreePine = mkIcon("▲"), Bike = mkIcon("►"), BookOpen = mkIcon("▣"), HeartHandshake = mkIcon("◎"),
  Languages = mkIcon("◎"), Plane = mkIcon("↗"), FlipHorizontal = mkIcon("↔"), Minus = mkIcon("−");

/* ══════════════════════════  EJABASHKOHU 4.0  ══
   E RE në këtë version:
   1. APROVIMI: kërkon → nikoqiri sheh kush je (foto+moshë) → aprovon → paguan
   2. FOTO E DETYRUESHME në regjistrim. Nikoqiri e di gjithmonë kush po vjen
   3. LOKACIONI: link i detyrueshëm i Google Maps nga nikoqiri
   4. MODELI: paguan ai që bashkohet (2 €), nikoqiri gjithmonë falas
   ═══════════════════════════════════════════════════════════════════ */

const BOOKING_FEE = 2.0;

const CITIES = [
  "Prishtinë", "Prizren", "Pejë", "Gjakovë", "Mitrovicë", "Ferizaj", "Gjilan",
  "Podujevë", "Vushtrri", "Suharekë", "Rahovec", "Drenas", "Lipjan", "Malishevë",
  "Kamenicë", "Viti", "Deçan", "Istog", "Klinë", "Skenderaj", "Dragash",
  "Fushë Kosovë", "Obiliq", "Shtime", "Kaçanik", "Junik", "Hani i Elezit",
  "Mamushë", "Graçanicë", "Shtërpcë", "Novobërdë", "Kllokot", "Ranillug",
  "Partesh", "Zubin Potok", "Zveçan", "Leposaviq", "Mitrovicë e Veriut",
];

const CATEGORIES = [
  { id: "kafe", label: "Kafe", icon: Coffee },
  { id: "pije", label: "Pije", icon: Beer },
  { id: "ushqim", label: "Ushqim", icon: UtensilsCrossed },
  { id: "natyre", label: "Natyrë", icon: Mountain },
  { id: "pishine", label: "Pishinë", icon: Waves },
  { id: "apartament", label: "Apartament", icon: Home },
  { id: "sport", label: "Sport", icon: Dumbbell },
  { id: "muzike", label: "Muzikë", icon: Music },
  { id: "lojera", label: "Lojëra", icon: Gamepad2 },
  { id: "hiking", label: "Hiking", icon: TreePine },
  { id: "biciklete", label: "Biçikletë", icon: Bike },
  { id: "studim", label: "Studim", icon: BookOpen },
  { id: "vullnetarizem", label: "Vullnetarizëm", icon: HeartHandshake },
  { id: "vozitje", label: "Vozitje", icon: Car },
  { id: "udhetim", label: "Udhëtim", icon: Plane },
];

/* Sports: every game belongs to exactly one sport (DB-enforced), so the feed can
   filter strictly: volleyball players never see football games and vice versa. */
const SPORTS = ["football", "basketball", "volleyball", "tennis", "padel", "table_tennis", "badminton", "running", "fitness"];
const SKILL_LEVELS = ["any", "beginner", "intermediate", "advanced"];
const SPORT_FILTER_KEY = "ejabashkohu-sport-filter";
const readSportFilter = () => {
  try { const v = localStorage.getItem(SPORT_FILTER_KEY); return SPORTS.includes(v) ? v : "all"; } catch { return "all"; }
};

/* Profile demo që dërgojnë kërkesa te tavolinat e tua (simulim i palës tjetër) */
const FAKE_REQUESTERS = [
  { name: "Erblin Krasniqi", age: 23, from: "Prishtinë" },
  { name: "Hanna Weber", age: 27, from: "Turiste nga Berlini" },
  { name: "Alba Gashi", age: 25, from: "Ferizaj" },
  { name: "Marco Rossi", age: 29, from: "Turist nga Milano" },
];

/* ── DARKA E SË MËRKURËS (modeli Timeleft) — display via t('wednesdayQuiz.*') ── */
const QUIZ = WED_QUIZ;

/* ══ AI MATCH: kuizi i profilit (5 pyetje) — labels via t('tasteQuiz.*') ══ */
const MATCH_QUIZ = [
  {
    key: 'groupSize',
    type: 'single',
    options: [{ v: 'vogla' }, { v: 'mesatare' }, { v: 'medha' }],
  },
  {
    key: 'depth',
    type: 'single',
    options: [{ v: 'thella' }, { v: 'argetim' }, { v: 'te-dyja' }],
  },
  {
    key: 'time',
    type: 'single',
    options: [{ v: 'paradite' }, { v: 'pasdite' }, { v: 'mbremje' }],
  },
  {
    key: 'energy',
    type: 'single',
    options: [{ v: 'introvert' }, { v: 'mes' }, { v: 'ekstrovert' }],
  },
  {
    key: 'interests',
    type: 'multi',
    max: 5,
    options: [
      { v: 'muzike' },
      { v: 'sport' },
      { v: 'libra' },
      { v: 'udhetim' },
      { v: 'art' },
      { v: 'teknologji' },
      { v: 'kulinari' },
      { v: 'natyre' },
    ],
  },
];

function quizAnswerFilled(q, val) {
  if (val === undefined || val === null) return false;
  if (q.type === 'multi') return Array.isArray(val) && val.length > 0;
  return true;
}

/** Host or confirmed member — matches myStatus joined/host checks for chat gating */
function canAccessTableChat(t, uid, userName, confirmedSeats, tickets) {
  if (!t || !uid) return false;
  if (t.host_id === uid || t.host === userName) return true;
  if (confirmedSeats?.has?.(t.id) || tickets?.[t.id]) return true;
  if ((t.joinedIds || []).includes(uid) || (t.joined || []).includes(userName)) return true;
  return false;
}

const LANGUAGES = [
  { v: 'sq', label: 'Shqip' },
  { v: 'en', label: 'English' },
  { v: 'de', label: 'Deutsch' },
  { v: 'it', label: 'Italiano' },
  { v: 'fr', label: 'Français' },
  { v: 'tr', label: 'Türkçe' },
  { v: 'sr', label: 'Српски' },
  { v: 'es', label: 'Español' },
  { v: 'mk', label: 'Македонски' },
];

const langLabel = (codeOrLabel) => {
  const found = LANGUAGES.find((l) => l.v === codeOrLabel || l.label === codeOrLabel);
  return found?.label ?? codeOrLabel;
};

const formatLangs = (langs) => (langs || []).map(langLabel).join(' · ');

/* Vibe i tavolinave të krijuara nga përdoruesi, sipas kategorisë (interest codes = tasteQuiz) */
const CAT_VIBE = {
  kafe: { interests: ['kulinari', 'libra'], time: null, depth: null, energy: 'mes' },
  pije: { interests: ['muzike'], time: 'mbremje', depth: 'argetim', energy: 'ekstrovert' },
  ushqim: { interests: ['kulinari'], time: 'mbremje', depth: 'thella', energy: 'mes' },
  natyre: { interests: ['udhetim', 'sport'], time: 'paradite', depth: 'argetim', energy: 'mes' },
  pishine: { interests: ['sport', 'udhetim'], time: 'pasdite', depth: 'argetim', energy: 'ekstrovert' },
  apartament: { interests: ['art', 'muzike'], time: 'mbremje', depth: 'argetim', energy: 'introvert' },
  sport: { interests: ['sport'], time: 'pasdite', depth: 'argetim', energy: 'ekstrovert' },
  muzike: { interests: ['muzike'], time: 'mbremje', depth: 'argetim', energy: 'ekstrovert' },
  lojera: { interests: ['teknologji'], time: 'mbremje', depth: 'argetim', energy: 'mes' },
  hiking: { interests: ['udhetim', 'sport'], time: 'paradite', depth: 'argetim', energy: 'mes' },
  biciklete: { interests: ['sport', 'udhetim'], time: 'paradite', depth: 'argetim', energy: 'ekstrovert' },
  studim: { interests: ['libra', 'teknologji'], time: 'pasdite', depth: 'thella', energy: 'introvert' },
  vullnetarizem: { interests: ['udhetim'], time: 'paradite', depth: 'thella', energy: 'mes' },
  vozitje: { interests: ['udhetim'], time: null, depth: null, energy: null },
  udhetim: { interests: ['udhetim'], time: null, depth: 'te-dyja', energy: 'mes' },
};
const WEEKEND_CAT = { natyre: "natyre", qytet: "kafe", nata: "muzike", shtepi: "apartament" };

/* Llogaritja e përputhjes (45-98) — 5 faktorë + afinitet */
const matchScore = (t, p, aff) => {
  if (!p.done) return null;
  let s = 45;
  const vibe = t.vibe || CAT_VIBE[t.cat] || {};
  const profileVibes = interestsForMatching(p.interests || []);
  const shared = (vibe.interests || []).filter((i) => profileVibes.includes(i));
  s += Math.min(5, shared.length) * 12;
  if (vibe.depth && (vibe.depth === p.depth || p.depth === "te-dyja")) s += 15;
  if (vibe.time && vibe.time === p.time) s += 12;
  const gs = t.spots <= 4 ? "vogla" : t.spots <= 6 ? "mesatare" : "medha";
  if (gs === p.groupSize) s += 12;
  if (vibe.energy && vibe.energy === p.energy) s += 10;
  s += Math.max(-15, Math.min(15, aff[t.cat] || 0));
  if (t.mystery) s = Math.max(s, 93);
  return Math.max(45, Math.min(98, Math.round(s)));
};

function buildExplainMatch(tr, table, p, aff) {
  if (table.mystery) return tr('tableDetail.matchMystery');
  const vibe = table.vibe || CAT_VIBE[table.cat] || {};
  const parts = [];
  const profileVibes = interestsForMatching(p.interests);
  const shared = (vibe.interests || []).filter((i) => profileVibes.includes(i));
  const interestLabel = (code) => tr(`tasteQuiz.questions.interests.options.${code}`);
  if (shared.length) {
    parts.push(tr('tableDetail.matchSharedInterest', {
      host: table.host.split(' ')[0],
      interests: shared.map(interestLabel).join(', '),
    }));
  }
  const gs = table.spots <= 4 ? 'vogla' : table.spots <= 6 ? 'mesatare' : 'medha';
  const sizeLabel = gs === 'vogla'
    ? tr('tableDetail.groupSizeSmall')
    : gs === 'mesatare'
      ? tr('tableDetail.groupSizeMedium')
      : tr('tableDetail.groupSizeLarge');
  const depthLabel = vibe.depth === 'thella'
    ? tr('tableDetail.depthDeep')
    : tr('tableDetail.depthFun');
  if (gs === p.groupSize && vibe.depth && (vibe.depth === p.depth || p.depth === 'te-dyja')) {
    parts.push(tr('tableDetail.matchGroupSizeDepth', { size: sizeLabel, depth: depthLabel }));
  } else if (gs === p.groupSize) {
    parts.push(tr('tableDetail.matchGroupSizeOnly', { spots: table.spots }));
  }
  if (vibe.time && vibe.time === p.time) parts.push(tr('tableDetail.matchTime'));
  if ((aff[table.cat] || 0) >= 6) parts.push(tr('tableDetail.matchAffinityPositive'));
  if ((aff[table.cat] || 0) <= -6) parts.push(tr('tableDetail.matchAffinityNegative'));
  if (!parts.length) parts.push(tr('tableDetail.matchFallback'));
  return parts.join(' ');
}

/* ── SILUETAT E QYTETEVE (SVG — pa foto të jashtme, gjithmonë funksionojnë) ── */
const cityVariant = (c) =>
  c === "Prizren" ? "prizren"
  : ["Pejë", "Deçan", "Istog", "Junik", "Klinë"].includes(c) ? "peja"
  : c === "Prishtinë" ? "prishtina"
  : "generic";

function CityScape({ variant = "generic", tone = "light", height = 78 }) {
  const dark = tone === "dark";
  const far = dark ? "rgba(255,255,255,0.06)" : "#F0F0F0";
  const near = dark ? "rgba(255,255,255,0.12)" : "#E8E8E8";
  const glow = dark ? "#00C9A7" : "#D9C79C";
  return (
    <svg viewBox="0 0 400 90" preserveAspectRatio="xMidYMax slice"
      style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      {variant === "prishtina" && (
        <>
          <g fill={far}>
            <rect x="0" y="50" width="34" height="40" />
            <rect x="40" y="40" width="22" height="50" />
            <rect x="296" y="46" width="26" height="44" />
            <rect x="330" y="56" width="46" height="34" />
            <rect x="380" y="44" width="20" height="46" />
          </g>
          <g fill={near}>
            {/* Kulla e antenës */}
            <rect x="70" y="30" width="6" height="60" />
            <rect x="72" y="12" width="2" height="20" />
            <rect x="86" y="46" width="26" height="44" />
            {/* Biblioteka Kombëtare: kubetë */}
            <rect x="120" y="60" width="72" height="30" />
            <circle cx="136" cy="60" r="9" />
            <circle cx="156" cy="55" r="12" />
            <circle cx="178" cy="60" r="9" />
            {/* Katedralja */}
            <rect x="212" y="32" width="14" height="58" />
            <rect x="217" y="20" width="4" height="14" />
            <rect x="212" y="26" width="14" height="4" />
            {/* NEWBORN */}
            <rect x="246" y="74" width="44" height="16" rx="3" />
          </g>
          {dark && (
            <g fill={glow} opacity="0.9">
              <rect x="92" y="54" width="4" height="5" /><rect x="102" y="66" width="4" height="5" />
              <rect x="8" y="60" width="4" height="5" /><rect x="46" y="50" width="4" height="5" />
              <rect x="216" y="46" width="5" height="6" /><rect x="340" y="64" width="4" height="5" />
              <rect x="150" y="70" width="4" height="5" /><rect x="386" y="52" width="4" height="5" />
            </g>
          )}
        </>
      )}
      {variant === "prizren" && (
        <>
          {/* Kalaja mbi kodër */}
          <g fill={far}>
            <path d="M240 90 L305 34 L370 90 Z" />
            <rect x="288" y="30" width="36" height="10" />
            <rect x="290" y="24" width="5" height="8" /><rect x="302" y="24" width="5" height="8" /><rect x="314" y="24" width="5" height="8" />
            <path d="M0 90 L60 58 L120 90 Z" />
          </g>
          <g fill={near}>
            {/* Ura e Gurit */}
            <path d="M30 90 v-20 h150 v20 h-22 v-12 a14 14 0 0 0 -28 0 v12 h-24 v-12 a14 14 0 0 0 -28 0 v12 Z" />
            {/* Xhamia e Sinan Pashës: minarja */}
            <rect x="206" y="34" width="7" height="56" />
            <polygon points="203,34 216,34 209.5,22" />
            <rect x="222" y="60" width="40" height="30" />
            <circle cx="242" cy="60" r="14" />
          </g>
          {dark && (
            <g fill={glow} opacity="0.9">
              <rect x="236" y="68" width="4" height="5" /><rect x="250" y="68" width="4" height="5" />
              <rect x="60" y="76" width="4" height="4" /><rect x="130" y="76" width="4" height="4" />
              <rect x="300" y="40" width="4" height="4" />
            </g>
          )}
        </>
      )}
      {variant === "peja" && (
        <>
          {/* Bjeshkët e Rugovës */}
          <g fill={far}>
            <path d="M0 90 L70 26 L150 90 Z" />
            <path d="M110 90 L200 14 L300 90 Z" />
            <path d="M260 90 L340 32 L400 90 Z" />
          </g>
          <g fill={near}>
            <path d="M40 90 L110 44 L190 90 Z" />
            <path d="M210 90 L290 40 L380 90 Z" />
            {/* shtëpi të vogla */}
            <rect x="150" y="76" width="18" height="14" /><polygon points="146,76 172,76 159,66" />
            <rect x="190" y="80" width="14" height="10" /><polygon points="187,80 207,80 197,72" />
          </g>
          {dark && (
            <g fill={glow} opacity="0.9">
              <rect x="156" y="80" width="4" height="4" /><rect x="194" y="83" width="3" height="3" />
            </g>
          )}
        </>
      )}
      {variant === "generic" && (
        <>
          <g fill={far}>
            <path d="M0 90 Q80 46 180 74 T400 60 V90 Z" />
          </g>
          <g fill={near}>
            <rect x="60" y="66" width="20" height="24" /><polygon points="56,66 84,66 70,54" />
            <rect x="100" y="72" width="16" height="18" /><polygon points="97,72 119,72 108,62" />
            <rect x="290" y="64" width="22" height="26" /><polygon points="286,64 316,64 301,52" />
            <rect x="330" y="72" width="14" height="18" />
          </g>
          {dark && (
            <g fill={glow} opacity="0.9">
              <rect x="66" y="72" width="4" height="5" /><rect x="296" y="70" width="4" height="5" />
            </g>
          )}
        </>
      )}
    </svg>
  );
}

/* ── Unaza e vendeve (elementi nënshkrim) ── */function SeatRing({ total, taken, size = 44 }) {
  const dots = [];
  const r = size / 2 - 4;
  for (let i = 0; i < total; i++) {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const x = size / 2 + r * Math.cos(angle);
    const y = size / 2 + r * Math.sin(angle);
    dots.push(
      <circle key={i} cx={x} cy={y} r={4}
        fill={i < taken ? "#FF6B35" : "none"}
        stroke={i < taken ? "#FF6B35" : "#00C9A7"}
        strokeWidth={i < taken ? 0 : 2} />
    );
  }
  return (
    <svg width={size} height={size} aria-label={`${taken} nga ${total} vende të zëna`}>
      <circle cx={size / 2} cy={size / 2} r={size / 5.5} fill="#FFF5F2" stroke="#FFD5C5" strokeWidth="1.5" />
      {dots}
    </svg>
  );
}

function Avatar({ name, photo, small, large }) {
  const cls = `avatar ${small ? "avatar-sm" : ""} ${large ? "avatar-lg" : ""}`;
  if (photo) return <img src={photo} alt={name} className={cls} style={{ objectFit: "cover" }} />;
  const hues = [217, 36, 152, 265, 12, 190];
  const h = hues[(name?.charCodeAt(0) || 0) % hues.length];
  return (
    <div className={cls} style={{ background: `hsl(${h} 55% 88%)`, color: `hsl(${h} 60% 32%)` }}>
      {name?.[0]?.toUpperCase() || "?"}
    </div>
  );
}

function Stars({ rating }) {
  return (
    <span className="stars" title={`${rating} / 5`}>
      ★ {rating.toFixed(1)}
    </span>
  );
}

/* ── Kartela ── */
const formatCardNum = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
const formatExpiry = (v) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
};
const validCard = (c) => {
  const num = c.num.replace(/\s/g, "");
  const [mm, yy] = c.exp.split("/").map(Number);
  return num.length === 16 && c.name.trim().length >= 3 && mm >= 1 && mm <= 12 && yy >= 26 && c.cvc.replace(/\D/g, "").length === 3;
};

const REPORT_REASON_CODES = ['inappropriate', 'fake_profile', 'spam', 'no_show', 'other']

const LEGACY_REPORT_REASON_CODES = {
  'Sjellje e papërshtatshme': 'inappropriate',
  'Profil i rremë ose foto e huaj': 'fake_profile',
  'Spam / reklamë': 'spam',
  'Nuk erdhi në takim': 'no_show',
  Tjetër: 'other',
}

const ADMIN_SCREEN_KEY = 'ejabashkohu-admin-screen';

function HajdeApp() {
  const { t, locale } = useI18n()
  const { user: authUser, loading, signIn, signUp, signOut, pendingEmailConfirmation, clearPendingEmailConfirmation } = useAuth()
  const [screen, setScreen] = useState("onboard");
  const [step, setStep] = useState(0);
  const [user, setUser] = useState({
    firstName: "", lastName: "", age: "24", email: "",
    name: "", from: "", isTourist: null, photo: null,
    photoPath: null, photoUploading: false,
  });
  const pendingAvatarFile = useRef(null);
  const avatarFlushing = useRef(false);
  /** User id from step-1 signUp — photo upload must match this session only */
  const [registrationUserId, setRegistrationUserId] = useState(null);
  /** 'google' | 'apple' while a social sign-up is finishing onboarding (step 1 = name only). */
  const [socialOnboarding, setSocialOnboarding] = useState(null);
  const [oauthBusy, setOauthBusy] = useState(null);
  const [memberPhotos, setMemberPhotos] = useState({});
  const [password, setPassword] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [showPolicy, setShowPolicy] = useState(null); // 'privacy' | 'terms' | null
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [resetLinkExpired, setResetLinkExpired] = useState(false);
  const [confirmLinkExpired, setConfirmLinkExpired] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordBusy, setNewPasswordBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resetCooldown, setResetCooldown] = useState(0);
  const emailValid = isEmailFormatValid(user.email);
  const passwordValid = password.length >= 8;
  const ageNum = parseInt(user.age, 10);
  const ageValid = !isNaN(ageNum) && ageNum >= 18 && ageNum <= 99;
  const ageTooYoung = !isNaN(ageNum) && user.age.length > 0 && ageNum < 18;
  const [city, setCity] = useState("Prishtinë");
  /* Packages: Bazike = home city only + monthly hosting limit; Premium = all. */
  const { plan, reload: reloadPlan, available: plansReady, isPremium, limitReached } = usePlan(authUser?.id);
  const [showPlans, setShowPlans] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const homeCity = plan?.home_city || null;
  const basicLocked = plansReady && !!plan && !isPremium;
  useEffect(() => {
    if (basicLocked && homeCity && city !== homeCity) setCity(homeCity);
  }, [basicLocked, homeCity, city]);
  const visibleCities = basicLocked ? (homeCity ? [homeCity] : []) : CITIES;
  const [locationSuggestedCity, setLocationSuggestedCity] = useState(null);
  const [showLocationBanner, setShowLocationBanner] = useState(false);
  const [showDeactivatedGate, setShowDeactivatedGate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [cat, setCat] = useState("all");
  const { profile: dbProfile, tasteProfile, affinity, badges: dbBadges, reload: reloadProfile, loading: profileLoading } = useProfile(authUser?.id);
  const { tables: rawTables, loading: tablesLoading, error: tablesError, refetch: refetchTables } = useTables(city, cat, tasteProfile || dbProfile, affinity);
  const tables = useMemo(
    () => rawTables.map((tbl) => ({
      ...tbl,
      time: tbl.event_datetime ? formatEventTime(tbl.event_datetime, locale) : tbl.time,
    })),
    [rawTables, locale],
  );
  const catLabel = (id) => t(`feed.categories.${id}`);
  const tagLabel = (code) => t(`feed.tagCodes.${code}`) || code;
  const createFabLabel = () => {
    if (cat === 'sport') return t('sports.fab');
    if (cat === 'vozitje') return t('feed.openTableVozitje');
    if (cat === 'udhetim') return t('feed.openTableUdhetim');
    return t('feed.openTableTavoline');
  };
  const formCreateFabLabel = () => {
    if (form.mode === 'sport') return t('sports.fab');
    if (form.mode === 'vozitje') return t('feed.openTableVozitje');
    if (form.mode === 'udhetim') return t('feed.openTableUdhetim');
    return t('feed.openTableTavoline');
  };

  const translateReportStatus = (status) => {
    const map = {
      pending: t('myReportsScreen.statusPending'),
      reviewed_banned: t('myReportsScreen.statusBanned'),
      reviewed_dismissed: t('myReportsScreen.statusDismissed'),
      deleted_immediately: t('myReportsScreen.statusDeleted'),
    };
    return map[status] || status;
  };

  const displayReportReason = (reason) => {
    if (REPORT_REASON_CODES.includes(reason)) {
      return t(`reportBlockSheet.reasons.${reason}`);
    }
    const legacyCode = LEGACY_REPORT_REASON_CODES[reason];
    if (legacyCode) return t(`reportBlockSheet.reasons.${legacyCode}`);
    return reason;
  };

  const mapErr = useCallback((err) => mapError(err, locale), [locale]);

  // Refetch tables once auth session is ready (RLS requires authenticated)
  useEffect(() => {
    if (authUser) refetchTables();
  }, [authUser, refetchTables]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const detected = nearestMunicipality(pos.coords.latitude, pos.coords.longitude);
        if (detected !== city) {
          setLocationSuggestedCity(detected);
          setShowLocationBanner(true);
        }
      },
      () => { /* permission denied. Silently do nothing */ },
      { timeout: 8000 },
    );
  }, []);

  const persistAdminScreen = useCallback((next) => {
    try {
      sessionStorage.setItem(ADMIN_SCREEN_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const setAdminScreen = useCallback((next) => {
    setScreen(next);
    persistAdminScreen(next);
  }, [persistAdminScreen]);

  const handlePostLogin = useCallback(async (userId, { preferStored = false } = {}) => {
    const { data } = await sb.from('profiles')
      .select('is_admin, deactivated_at')
      .eq('id', userId)
      .single();

    if (data?.deactivated_at) {
      setShowDeactivatedGate(true);
      setScreen('onboard');
      setStep(0);
      return;
    }

    if (data?.is_admin) {
      setIsAdmin(true);
      let next = 'admin';
      if (preferStored) {
        try {
          const stored = sessionStorage.getItem(ADMIN_SCREEN_KEY);
          if (stored === 'main' || stored === 'admin') next = stored;
        } catch {
          /* ignore */
        }
      } else {
        persistAdminScreen('admin');
      }
      setScreen(next);
      if (preferStored) persistAdminScreen(next);
      return;
    }

    setIsAdmin(false);
    setScreen('main');
  }, [persistAdminScreen]);

  useEffect(() => {
    if (!authUser?.id) {
      setShowDeactivatedGate(false);
      return;
    }
    sb.from('profiles').select('deactivated_at').eq('id', authUser.id)
      .single().then(({ data }) => {
        setShowDeactivatedGate(!!data?.deactivated_at);
      });
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) return;
    sb.rpc('get_my_wednesday_groups')
      .then(({ data }) => {
        if (!data?.length) return;
        const upcoming = data
          .filter((r) => r.dinner_date && new Date(r.dinner_date) >= new Date())
          .sort((a, b) => new Date(a.dinner_date) - new Date(b.dinner_date))[0];
        if (upcoming) wedTableGroupId.current = upcoming.group_id;
      });
  }, [authUser?.id]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(null);
  const [tickets, setTickets] = useState({});
  /** Optimistic joined seats after stub payment (until refetch catches up) */
  const [confirmedSeats, setConfirmedSeats] = useState(() => new Set());
  const activeTableForChat = tables.find((t) => t.id === active);
  const chatUnlocked = canAccessTableChat(
    activeTableForChat,
    authUser?.id,
    user.name,
    confirmedSeats,
    tickets,
  );
  const {
    messages: chatMessages,
    sendMessage: sendChatMsg,
    loading: chatLoading,
  } = useChat(chatUnlocked ? active : null);
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState("zbulo");
  const [toast, setToast] = useState(null);
  const [msg, setMsg] = useState("");
  const chatEndRef = useRef(null);
  const fileRef = useRef(null);

  /* Njoftimet + kërkesat live (Supabase) */
  const { notifs, unread, setUnread, markRead, clearNotifs, pushNotif } = useNotifications(authUser?.id);
  const {
    pendingRequests,
    approveRequest: approveRequestLive,
    rejectRequest: rejectRequestLive,
  } = useRequests(active, authUser?.id);
  const [showNotifs, setShowNotifs] = useState(false);

  // Keep table feed in sync when live requests change (host has a table open)
  useEffect(() => {
    if (active) void refetchTables();
  }, [pendingRequests.length, active, refetchTables]);

  // Guest: refresh membership/request status while table detail stays open
  useEffect(() => {
    if (!active || !authUser?.id) return;
    const channel = sb
      .channel(`membership-${active}-${authUser.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'memberships',
          filter: `table_id=eq.${active}`,
        },
        (payload) => {
          const row = payload.new;
          if (row?.user_id === authUser.id) {
            console.log('[ejaBashkohu] Membership channel update:', row.status);
            void refetchTables();
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'requests',
          filter: `table_id=eq.${active}`,
        },
        (payload) => {
          const row = payload.new;
          if (row?.user_id === authUser.id) {
            console.log('[ejaBashkohu] Request channel update:', row.status);
            void refetchTables();
          }
        },
      )
      .subscribe((status) => {
        console.log('[ejaBashkohu] Membership channel status:', status);
      });
    return () => { sb.removeChannel(channel); };
  }, [active, authUser?.id, refetchTables]);

  /* Pagesa */
  const [payFor, setPayFor] = useState(null);
  const [payMethod, setPayMethod] = useState("card");
  const [card, setCard] = useState({ num: "", exp: "", cvc: "", name: "" });
  const [payState, setPayState] = useState("idle");
  const simulatedApproval = useRef(new Set());
  const simulatedIncoming = useRef(new Set());

  // Hydrate ticket codes from paid stub/real payments (survives reload)
  useEffect(() => {
    if (!authUser?.id) {
      setTickets({});
      setConfirmedSeats(new Set());
      return;
    }
    let cancelled = false;
    sb.from("payments")
      .select("table_id, ticket_code")
      .eq("user_id", authUser.id)
      .eq("status", "paid")
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setTickets((prev) => {
          const next = { ...prev };
          for (const p of data) {
            if (p.table_id && p.ticket_code) next[p.table_id] = p.ticket_code;
          }
          return next;
        });
      });
    return () => { cancelled = true; };
  }, [authUser?.id]);

  const [form, setForm] = useState({
    mode: "tavoline", city: "Prishtinë", toCity: "Prizren", budget: "",
    cafe: "", area: "", eventDate: "", eventTime: "", spots: 4, cat: "kafe",
    desc: "", langs: ["sq"], womenOnly: false, menOnly: false, mapsLink: "",
    sport: "", level: "any",
  });
  const [sportFilter, setSportFilterState] = useState(readSportFilter);
  /* "Shiko" switcher: each type of listing is shown on its own, never mixed. */
  const [lessonsView, setLessonsView] = useState({ view: 'find', key: 0 });
  const feedMode = cat === "sport" ? "sport" : cat === "udhetim" ? "trips" : cat === "vozitje" ? "rides" : "tables";
  const setFeedMode = (m) => {
    if (m === "lessons") { setLessonsView((v) => ({ view: 'groups', key: v.key + 1 })); setTab("mesime"); return; }
    setCat(m === "sport" ? "sport" : m === "trips" ? "udhetim" : m === "rides" ? "vozitje" : "all");
  };
  const setSportFilter = (v) => {
    setSportFilterState(v);
    try { localStorage.setItem(SPORT_FILTER_KEY, v); } catch { /* ignore */ }
  };
  const defaultCreateForm = () => ({
    mode: "tavoline",
    city: "Prishtinë",
    toCity: "Prizren",
    budget: "",
    cafe: "",
    area: "",
    ...defaultEventSchedule(),
    spots: 4,
    cat: "kafe",
    desc: "",
    langs: ["sq"],
    womenOnly: false,
    menOnly: false,
    mapsLink: "",
    sport: "",
    level: "any",
  });
  const openCreate = () => {
    const mode = cat === "vozitje" ? "vozitje" : cat === "udhetim" ? "udhetim" : cat === "sport" ? "sport" : "tavoline";
    const schedule = defaultEventSchedule();
    setForm((f) => ({
      ...f,
      city,
      mode,
      spots: mode === "vozitje" ? 3 : mode === "udhetim" ? 5 : mode === "sport" ? 10 : 4,
      sport: mode === "sport" && sportFilter !== "all" ? sportFilter : f.sport,
      eventDate: schedule.eventDate,
      eventTime: schedule.eventTime,
    }));
    setShowCreate(true);
  };

  /* Darka e së Mërkurës (Timeleft) */
  const [showWed, setShowWed] = useState(false);
  const [quizStep, setQuizStep] = useState(0);
  const [quizAns, setQuizAns] = useState([]);
  const [wedLangSel, setWedLangSel] = useState([]);
  const [wedShowOtherInput, setWedShowOtherInput] = useState(false);
  const [wedOtherText, setWedOtherText] = useState('');
  const [matchState, setMatchState] = useState("quiz"); // quiz | matching | matched
  const [wedDone, setWedDone] = useState(false);
  const wedTableId = useRef(null);
  const wedTableGroupId = useRef(null);
  const [restaurant, setRestaurant] = useState(null);
  const [revealChecked, setRevealChecked] = useState(false);

  /* Vlerësimi pas takimit */
  const [rateFor, setRateFor] = useState(null);
  const [rateStars, setRateStars] = useState(0);
  const [rateAgain, setRateAgain] = useState(null);
  const [rated, setRated] = useState({});
  const [rateSelect, setRateSelect] = useState([]);   // picked user UUIDs
  const [connections, setConnections] = useState([]); // [{ id, name }]

  /* Përputhja: profili nga kuizi + afiniteti i mësuar nga sjellja */
  const [profile, setProfile] = useState({ done: false, groupSize: null, depth: null, time: null, energy: null, interests: [], langs: ["Shqip"] });
  const [aff, setAff] = useState({});                 // { kategori: pikë të mësuara }
  const [showMQ, setShowMQ] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [mqi, setMqi] = useState(0);
  const prevAuthId = useRef(null);
  const manualSignOutRef = useRef(false);
  const hadAuthSessionRef = useRef(false);
  const sessionExpiryHandledRef = useRef(false);

  const resetLocalUserState = () => {
    setUser({
      firstName: "", lastName: "", age: "24", email: "",
      name: "", from: "", isTourist: null,
      photo: null, photoPath: null, photoUploading: false,
    });
    setPassword("");
    setProfile({ done: false, groupSize: null, depth: null, time: null, energy: null, interests: [], langs: ["Shqip"] });
    setAff({});
    setQuizAnswers({});
    setMqi(0);
    setMemberPhotos({});
    pendingAvatarFile.current = null;
    setRegistrationUserId(null);
    clearPendingRegistration();
    setForm(defaultCreateForm());
  };

  const startRegistration = async () => {
    await signOut();
    resetLocalUserState();
    setSocialOnboarding(null);
    setAuthError(null);
    setAuthBusy(false);
    setAgreedToTerms(false);
    setShowSignIn(false);
    setStep(1);
  };

  const clearAuthSessionState = ({ showSignInAfter = false } = {}) => {
    resetLocalUserState();
    setSocialOnboarding(null);
    setOauthBusy(null);
    clearNotifs();
    setUnread(0);
    setActive(null);
    setShowCreate(false);
    setShowMQ(false);
    setShowDeactivatedGate(false);
    setForgotPassword(false);
    setForgotSent(false);
    setPasswordRecovery(false);
    setResetLinkExpired(false);
    setConfirmLinkExpired(false);
    setNewPassword("");
    setShowSignIn(showSignInAfter);
    clearAvatarCache();
    try {
      sessionStorage.removeItem(ADMIN_SCREEN_KEY);
    } catch {
      /* ignore */
    }
    setIsAdmin(false);
    setRegistrationUserId(null);
    setScreen("onboard");
    setStep(0);
  };

  const handleSessionExpired = () => {
    if (manualSignOutRef.current || sessionExpiryHandledRef.current) return;
    sessionExpiryHandledRef.current = true;
    hadAuthSessionRef.current = false;
    clearAuthSessionState({ showSignInAfter: true });
    showToast(t('toasts.sessionExpired'));
  };

  const handleSignOut = async () => {
    manualSignOutRef.current = true;
    hadAuthSessionRef.current = false;
    try {
      await signOut();
      clearAuthSessionState();
      showToast(t('profile.signOutSuccessToast'));
    } finally {
      manualSignOutRef.current = false;
    }
  };

  const deactivateAccount = async () => {
    if (!window.confirm(t('profile.confirmDeactivate'))) return;

    if (!window.confirm(t('profile.confirmDeactivateSecond'))) return;

    try {
      await sb.from('profiles')
        .update({ deactivated_at: new Date().toISOString() })
        .eq('id', authUser.id);
      await handleSignOut();
      showToast(t('profile.deactivateSuccessToast'));
    } catch (err) {
      showToast(t('profile.deactivateFailedToast'));
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (resetCooldown <= 0) return;
    const timer = setTimeout(() => setResetCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  useEffect(() => {
    if (
      screen === 'onboard' &&
      step >= 2 &&
      step <= 4 &&
      !registrationUserId &&
      !showSignIn &&
      !authBusy
    ) {
      setStep(1);
      setAuthError(t('errors.restartRegistrationFromStep1'));
    }
  }, [screen, step, registrationUserId, showSignIn, authBusy]);

  useEffect(() => {
    if (prevAuthId.current && authUser?.id && prevAuthId.current !== authUser.id) {
      resetLocalUserState();
      setQuizAnswers({});
      setUser((u) => ({ ...u, photo: null, photoPath: null }));
      clearAvatarCache();
    }
    prevAuthId.current = authUser?.id ?? null;
  }, [authUser?.id]);

  useEffect(() => {
    const hashError = parseAuthHashError();
    if (hashError) {
      clearAuthHashFromUrl();
      const pending = loadPendingRegistration();
      if (pending?.email) {
        setConfirmLinkExpired(true);
        setUser((u) => ({ ...u, email: pending.email }));
      } else {
        setResetLinkExpired(true);
        setShowSignIn(true);
      }
      setScreen('onboard');
      setStep(0);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (authUser?.id) {
      hadAuthSessionRef.current = true;
      sessionExpiryHandledRef.current = false;
      return;
    }
    if (hadAuthSessionRef.current) {
      handleSessionExpired();
    }
  }, [authUser?.id, loading]);

  useEffect(() => {
    const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setResetLinkExpired(false);
        setConfirmLinkExpired(false);
        setScreen('onboard');
        setStep(0);
        setShowSignIn(true);
        return;
      }
      if (event === 'SIGNED_OUT') {
        handleSessionExpired();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (showMQ) console.log('[ejaBashkohu] quizAnswers:', quizAnswers, 'mqi:', mqi);
  }, [showMQ, quizAnswers, mqi]);

  const openMatchQuiz = (startIndex = 0) => {
    setQuizAnswers((prev) => {
      const merged = { ...prev };
      for (const q of MATCH_QUIZ) {
        if (quizAnswerFilled(q, merged[q.key])) continue;
        const fromProfile = profile[q.key];
        if (quizAnswerFilled(q, fromProfile)) merged[q.key] = fromProfile;
      }
      return merged;
    });
    setMqi(startIndex);
    setShowMQ(true);
  };

  const submitNewPassword = async (e) => {
    e?.preventDefault?.();
    if (newPassword.length < 6) {
      showToast(t('toasts.passwordMinLength'));
      return;
    }
    setNewPasswordBusy(true);
    try {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordRecovery(false);
      setNewPassword('');
      await signOut();
      resetLocalUserState();
      setScreen('onboard');
      setStep(0);
      setShowSignIn(true);
      showToast(t('toasts.passwordChangedSignInAgain'));
    } catch {
      showToast(t('toasts.genericFailed'));
    } finally {
      setNewPasswordBusy(false);
    }
  };

  // Hydrate ratings + mutual connections + affinity from DB
  useEffect(() => {
    if (!authUser?.id) {
      setRated({});
      setConnections([]);
      setAff({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [ratingsRes, connRes, affRes] = await Promise.all([
          sb.from("ratings").select("table_id, stars").eq("rater_id", authUser.id),
          sb.from("connections").select("a, b").or(`a.eq.${authUser.id},b.eq.${authUser.id}`),
          sb.from("affinity").select("category, score").eq("user_id", authUser.id),
        ]);
        if (cancelled) return;

        if (ratingsRes.data) {
          const map = {};
          for (const r of ratingsRes.data) map[r.table_id] = r.stars;
          setRated(map);
        }

        if (affRes.data) {
          const map = {};
          for (const row of affRes.data) map[row.category] = row.score;
          setAff(map);
        }

        const rows = connRes.data || [];
        if (rows.length === 0) {
          setConnections([]);
          return;
        }
        const otherIds = rows.map((c) => (c.a === authUser.id ? c.b : c.a));
        const { data: profiles } = await sb
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", otherIds);
        if (cancelled) return;
        setConnections(
          (profiles || []).map((p) => ({
            id: p.id,
            name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || t('myReportsScreen.defaultUserName'),
          })),
        );
      } catch (err) {
        console.error("Failed to load ratings/connections:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.id]);

  // Seed local quiz state from persisted taste_profiles (survives reload)
  useEffect(() => {
    if (!tasteProfile?.done) return;
    setProfile((prev) => ({
      ...prev,
      groupSize: tasteProfile.group_size ?? prev.groupSize,
      depth: tasteProfile.depth ?? prev.depth,
      time: tasteProfile.time_pref ?? prev.time,
      energy: tasteProfile.energy ?? prev.energy,
      interests: normalizeInterests(Array.isArray(tasteProfile.interests) ? tasteProfile.interests : (prev.interests || [])),
      langs: prev.langs?.length ? prev.langs : ["Shqip"],
      done: true,
    }));
    setWedDone(false); // taste done → allow Wednesday Dinner banner
  }, [tasteProfile]);

  // Hydrate avatar from profiles.photo_path (signed URL)
  useEffect(() => {
    if (!authUser?.id) return;
    if (!dbProfile?.photo_path) {
      setUser((u) => (u.photoPath ? u : { ...u, photo: null, photoPath: null }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const signedUrl = await getAvatarUrl(dbProfile.photo_path);
        if (cancelled || !signedUrl) return;
        setUser((u) => ({
          ...u,
          photo: signedUrl,
          photoPath: dbProfile.photo_path,
        }));
      } catch (err) {
        console.error("[ejaBashkohu] Photo load on reload failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.id, dbProfile?.id, dbProfile?.photo_path]);

  /* Siguria: raporto / blloko — reportFor = { id, name } */
  const [reportFor, setReportFor] = useState(null);
  const [reportReason, setReportReason] = useState(null);
  const [reportBlock, setReportBlock] = useState(false);
  const [blockPromptFor, setBlockPromptFor] = useState(null);
  const [blocked, setBlocked] = useState([]); // host_id uuids (+ legacy names)
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [changeCurrentPassword, setChangeCurrentPassword] = useState("");
  const [changeNewPassword, setChangeNewPassword] = useState("");
  const [changeConfirmPassword, setChangeConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [myReports, setMyReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);

  // Hydrate blocks so hidden hosts stay hidden after reload
  useEffect(() => {
    if (!authUser?.id) {
      setBlocked([]);
      return;
    }
    let cancelled = false;
    sb.from("blocks")
      .select("blocked_id")
      .eq("blocker_id", authUser.id)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setBlocked(data.map((b) => b.blocked_id).filter(Boolean));
      });
    return () => { cancelled = true; };
  }, [authUser?.id]);

  useEffect(() => {
    if (screen !== "blocked-users" || !authUser?.id) return;
    let cancelled = false;
    setLoadingBlocked(true);
    (async () => {
      const { data, error } = await sb
        .from("blocks")
        .select("blocked_id, created_at, profiles!blocks_blocked_id_fkey(first_name, last_name, photo_path)")
        .eq("blocker_id", authUser.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("Load blocked users failed:", error);
        setBlockedUsers([]);
        setLoadingBlocked(false);
        return;
      }
      const enriched = await Promise.all(
        (data || []).map(async (row) => {
          const p = row.profiles;
          let photo = null;
          if (p?.photo_path) {
            try {
              photo = await getAvatarUrl(p.photo_path);
            } catch {
              /* optional avatar */
            }
          }
          return {
            blocked_id: row.blocked_id,
            created_at: row.created_at,
            profiles: p,
            photo,
            displayName: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || t('myReportsScreen.defaultUserName'),
          };
        }),
      );
      setBlockedUsers(enriched);
      setLoadingBlocked(false);
    })();
    return () => { cancelled = true; };
  }, [screen, authUser?.id]);

  useEffect(() => {
    if (screen !== "my-reports" || !authUser?.id) return;
    setLoadingReports(true);
    sb.from("reports")
      .select("id, reason, status, created_at, reported_id, table_id, profiles!reports_reported_id_fkey(first_name, last_name)")
      .eq("reporter_id", authUser.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error("Load my reports failed:", error);
        setMyReports(error ? [] : (data || []));
        setLoadingReports(false);
      });
  }, [screen, authUser?.id]);

  /* ── Dritarja e detyrueshme e profilit ── */
  const [profileView, setProfileView] = useState(null);
  const [photoError, setPhotoError] = useState(null);
  const hostProf = (t) => ({
    id: t.host_id,
    name: t.host, age: t.hostAge, from: t.hostFrom, verified: t.hostVerified,
    rating: t.hostRating, tablesHeld: t.hostTables, langs: t.langs,
    photo: t.host_id === authUser?.id
      ? user.photo
      : (memberPhotos[t.host_id] || null),
    isHost: true,
  });
  const liteProf = (name, id = null) => ({
    id: id || (name === user.name ? authUser?.id : null),
    name,
    photo: id === authUser?.id || name === user.name
      ? user.photo
      : (id ? memberPhotos[id] : null),
    age: name === user.name ? user.age : undefined,
    from: name === user.name
      ? (user.isTourist ? (user.from || t('feed.tourist')) : t('feed.kosovo'))
      : t('appMisc.verifiedParticipant'),
  });

  /* Lista e pritjes + distinktivat */
  const simulatedWait = useRef(new Set());
  // Badge ids the user owns. Source of truth is the `badges` table: the server
  // awards each badge once per user ever (award_badge RPC), so reloading the app
  // or opening another table never re-awards "Nikoqiri i ri".
  const [badges, setBadges] = useState([]);
  useEffect(() => {
    if (!authUser?.id) { setBadges([]); return; }
    setBadges((dbBadges || []).map((b) => b.badge_id));
  }, [authUser?.id, dbBadges]);
  const awardBadge = (id) => {
    if (!authUser?.id || badges.includes(id)) return;
    awardBadgeOnce(id)
      .then((isNew) => {
        setBadges((prev) => (prev.includes(id) ? prev : [...prev, id]));
        if (isNew) showToast(t('toasts.badgeEarned', { label: t(`badges.${BADGE_LABEL_KEY[id]}`) }));
      })
      .catch((err) => console.error('[ejaBashkohu] award_badge failed:', err));
  };
  const answerQuiz = (key, value) => {
    setQuizAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const handleQuizAnswer = (value) => {
    const Q = MATCH_QUIZ[mqi];
    const wasAlreadyAnswered = quizAnswerFilled(Q, quizAnswers[Q.key]);
    if (Q.type === "multi") {
      setQuizAnswers((prev) => {
        const cur = prev[Q.key] || [];
        let next;
        if (cur.includes(value)) {
          next = cur.filter((x) => x !== value);
        } else if (cur.length < (Q.max || 5)) {
          next = [...cur, value];
        } else {
          next = cur;
        }
        if (!next.length) {
          const { [Q.key]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [Q.key]: next };
      });
      return;
    }
    answerQuiz(Q.key, value);
    if (!wasAlreadyAnswered && mqi < MATCH_QUIZ.length - 1) {
      setTimeout(() => setMqi((i) => i + 1), 250);
    }
  };

  const skipQuizQuestion = () => {
    if (mqi < MATCH_QUIZ.length - 1) setMqi((i) => i + 1);
    else void finishMQ();
  };

  const finishMQ = async () => {
    const normalizedAnswers = {
      ...quizAnswers,
      interests: normalizeInterests(quizAnswers.interests || []),
    };
    const completed = { ...profile, ...normalizedAnswers, done: true };
    setProfile(completed);
    setShowMQ(false);
    setMqi(0);

    try {
      await saveTasteProfile({
        group_size: completed.groupSize,
        depth: completed.depth,
        time_pref: completed.time,
        energy: completed.energy,
        interests: completed.interests || [],
      });
      void reloadProfile();
      void pushNotif('tasteProfileSaved', {}, "");
    } catch (err) {
      console.error("Failed to save taste profile:", err);
      // Local state still works; user can continue
      void pushNotif('tasteProfileLocalFailed', {}, "");
    }

    awardBadge("profil", "", t('badges.profileComplete'));
    showToast(t('toasts.matchActivated'));
  };

  const isRide = (t) => t?.cat === "vozitje";
  const tableFee = (t) => (isRide(t) ? 0 : BOOKING_FEE);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [active, chatMessages]);

  const showToast = useCallback((t) => {
    setToast(t);
    setTimeout(() => setToast(null), 2800);
  }, []);

  const activeTable = tables.find((t) => t.id === active);
  const payTable = tables.find((t) => t.id === payFor);

  useEffect(() => {
    const members = activeTable?.members;
    if (!members?.length) {
      setMemberPhotos({});
      return;
    }
    let cancelled = false;
    (async () => {
      const photos = {};
      await Promise.all(
        members.map(async (m) => {
          if (!m.photo_path || !m.user_id) return;
          try {
            const url = await getAvatarUrl(m.photo_path);
            if (url) photos[m.user_id] = url;
          } catch {
            /* initials fallback */
          }
        }),
      );
      if (!cancelled) setMemberPhotos(photos);
    })();
    return () => { cancelled = true; };
  }, [activeTable?.id, activeTable?.members]);

  useEffect(() => {
    const gid = wedTableGroupId.current;
    if (!activeTable?.mystery || !gid) {
      setRestaurant(null);
      setRevealChecked(false);
      return;
    }
    setRevealChecked(false);
    sb.rpc('get_wednesday_restaurant', { p_group: gid })
      .then(({ data }) => {
        setRestaurant(data || null);
        setRevealChecked(true);
      });
  }, [activeTable?.id, activeTable?.mystery]);

  const displayMessages = (chatMessages || []).map((m) => ({
    id: m.id,
    from: m.sender?.first_name ?? "Anonim",
    text: m.body,
    time: new Date(m.created_at).toLocaleTimeString("sq", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    mine: m.sender_id === authUser?.id,
  }));

  const filtered = tables
    .filter((t) =>
      !blocked.includes(t.host_id) &&
      !blocked.includes(t.host) &&
      t.city === city &&
      (cat === "all" || t.cat === cat) &&
      (feedMode !== "tables" || !["vozitje", "udhetim", "sport"].includes(t.kind)) &&
      (cat !== "sport" || sportFilter === "all" || t.sport === sportFilter) &&
      (query === "" || (t.cafe + t.desc + (t.tags || []).join(" ")).toLowerCase().includes(query.toLowerCase()))
    )
    .map((t) => ({ ...t, _match: matchScore(t, profile, aff) }))
    .sort((a, b) => {
      const ta = a.event_datetime ? new Date(a.event_datetime).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.event_datetime ? new Date(b.event_datetime).getTime() : Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      return (b._match ?? 0) - (a._match ?? 0);
    });
  const myTables = tables.filter((t) =>
    (t.joinedIds || []).includes(authUser?.id) || t.joined.includes(user.name) ||
    (t.requests || []).some((r) => r.user_id === authUser?.id || r.name === user.name)
  );
  const pendingRequestsForMe = tables
    .filter((t) => t.host_id === authUser?.id || t.host === user.name)
    .reduce((n, t) => n + (t.requests || []).filter((r) => r.status === "pending").length, 0);

  const tasteDone = tasteProfile?.done === true || profile?.done === true;

  /* Statusi i marrëdhënies sime me tavolinën */
  const myStatus = (t) => {
    const uid = authUser?.id;
    if (t.host_id === uid || t.host === user.name) return "host";
    if (
      confirmedSeats.has(t.id) ||
      tickets[t.id] ||
      (t.joinedIds || []).includes(uid) ||
      t.joined.includes(user.name)
    ) return "joined";
    const r = (t.requests || []).find((x) => x.user_id === uid || x.name === user.name);
    if (r?.status === "approved") return "approved";
    if (r?.status === "pending") return "pending";
    if ((t.waitlistIds || []).includes(uid) || (t.waitlist || []).includes(user.name)) return "waitlist";
    if (t.joined.length >= t.spots) return "full";
    return "none";
  };

  /* ── HAPI 1: Kërkesa (falas) — nikoqiri njoftohet dhe sheh kush je ── */
  const requestJoin = async (id) => {
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    if (t.isExpired || isTableExpired(t.event_datetime)) {
      showToast(t('tableDetail.toastTableExpired'));
      return;
    }
    try {
      await apiRequestJoin(id);
      await refetchTables();
      showToast(t('toasts.requestSent', { host: tbl.host }));
    } catch (err) {
      showToast(mapErr(err));
    }
  };

  const cancelRequest = async () => {
    showToast(t('toasts.cancelRequestSoon'));
  };

  /* ── HAPI 2: Pas aprovimit → pagesa (tavolinat) ose konfirmimi falas (vozitjet) ── */
  const startPayment = (id) => { setPayState("idle"); setPayMethod("card"); setPayFor(id); };

  const confirmFreeSeat = async (id) => {
    const t = tables.find((x) => x.id === id);
    try {
      await apiConfirmFreeSeat(id);
      setConfirmedSeats((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      await refetchTables();
      awardBadge("first-join", "", t('badges.firstJoin'));
      pushNotif('seatConfirmedRide', { area: tbl?.area?.replace("Nisja: ", "") || "", time: tbl?.time || "" }, "►");
      showToast(t('toasts.seatConfirmedFree'));
    } catch (err) {
      showToast(mapErr(err));
    }
  };

  const confirmPayment = () => {
    if (payMethod === "card" && !validCard(card)) { showToast(t('payment.validationCardInvalid')); return; }
    if (!payFor || !authUser?.id) { showToast(t('errors.mustSignInPay')); return; }
    setPayState("processing");
    const tableId = payFor;
    const userId = authUser.id;
    const tableSnap = tables.find((t) => t.id === tableId);
    const amountCents = Math.round((tableFee(tableSnap) || BOOKING_FEE) * 100);
    const hostId = tableSnap?.host_id;
    const tableTitle = tableSnap?.cafe || tableSnap?.title || "";

    setTimeout(async () => {
      /*
       * STUB PAYMENT — no real money moves.
       * Real provider integration: see api/payments.js
       * Webhook must call confirm_paid_seat (service role only). Never from client.
       * Remove these direct writes when the webhook is live.
       */
      try {
        if (!tableId || !userId) throw new Error(t('errors.sessionMissing'));

        const code = "EBK-" + String(1000 + Math.floor(Math.random() * 9000));

        // 1) Membership FIRST — RLS requires request status still = 'approved'
        const { error: memErr } = await sb
          .from("memberships")
          .insert({ table_id: tableId, user_id: userId, role: "member" });

        if (memErr && memErr.code !== "23505") {
          console.error("Membership insert failed:", memErr);
          throw new Error(
            memErr.message?.includes("approved")
              ? t('errors.paymentWithoutApproval')
              : t('errors.seatNotConfirmedRetry'),
          );
        }

        // 2) Mark request confirmed
        const { error: reqErr } = await sb
          .from("requests")
          .update({ status: "confirmed" })
          .eq("table_id", tableId)
          .eq("user_id", userId);

        if (reqErr) {
          console.error("Request confirm failed:", reqErr);
          throw new Error(t('errors.requestUpdateFailed'));
        }

        // 3) Payment record (cosmetic ticket; seat already confirmed)
        const { error: payErr } = await sb
          .from("payments")
          .insert({
            user_id: userId,
            table_id: tableId,
            amount_cents: amountCents,
            currency: "EUR",
            provider: "stub",
            provider_ref: "STUB-" + Date.now(),
            status: "paid",
            ticket_code: code,
            refundable: false,
          });

        if (payErr && payErr.code !== "23505") {
          console.error("Payment record failed:", payErr);
          // Don't throw — seat is already confirmed
        }

        // 4) Notify host (policy: stub_notify_table_host — requires membership first)
        if (hostId && hostId !== userId) {
          const { error: notifErr } = await sb.from("notifications").insert({
            user_id: hostId,
            icon: "check",
            // kind + params: the host reads this in THEIR language, not the guest's
            kind: 'hostSeatConfirmedNotif',
            params: { guest: user.firstName || t('feed.profileMe'), table: tableTitle },
            body: t('notifications.hostSeatConfirmedNotif', {
              guest: user.firstName || t('feed.profileMe'),
              table: tableTitle,
            }),
          });
          if (notifErr) console.error("Host notify failed:", notifErr);
        }

        awardBadge("first-join", "", t('badges.firstJoin'));
        setTickets((prev) => ({ ...prev, [tableId]: code }));
        setConfirmedSeats((prev) => {
          const next = new Set(prev);
          next.add(tableId);
          return next;
        });
        setPayState("success");
        void pushNotif('seatConfirmedTicket', { code }, "");

        // Refresh feed so host/guest seat counts + chat RLS membership sync
        await refetchTables();
      } catch (err) {
        console.error("Payment stub error:", err);
        setPayState("idle");
        showToast(mapErr(err));
      }
    }, 1400);
  };

  const closePayment = (openTable) => {
    const id = payFor;
    setPayFor(null); setPayState("idle");
    setCard({ num: "", exp: "", cvc: "", name: "" });
    if (openTable && id) setActive(id);
  };

  /* ── Lista e pritjes ── */
  const joinWaitlist = async (id) => {
    try {
      await apiJoinWaitlist(id);
      await refetchTables();
      showToast(t('toasts.waitlistJoined'));
    } catch (err) {
      showToast(mapErr(err));
    }
  };
  const leaveWaitlist = async (id) => {
    try {
      await apiLeaveWaitlist(id);
      await refetchTables();
      showToast(t('toasts.waitlistLeft'));
    } catch (err) {
      showToast(mapErr(err));
    }
  };

  /* ── Siguria: ndaje planin me një mik ── */
  const sharePlan = async (tbl) => {
    const place = tbl?.cafe || tbl?.title || t('appMisc.tableFallback');
    const citySeg = tbl?.area ? `${tbl.area}, ${tbl.city}` : tbl?.city;
    const locationPart = citySeg ? `(${citySeg}), ` : "";
    const timePart = tbl?.time ? `${tbl.time}, ` : "";
    const shareText = t('appMisc.sharePlanText', { place, locationPart, timePart });
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        showToast(t('toasts.planShared'));
        return;
      }
      await navigator.clipboard.writeText(shareText);
      showToast(t('toasts.copiedPaste'));
    } catch {
      showToast(t('toasts.copyManual', { place, time: tbl.time }));
    }
  };

  /* ── Raporto / Blloko ── */
  const blockUser = async (targetId, targetName, { confirm = true } = {}) => {
    if (!authUser?.id || !targetId) return false;
    const label = targetName?.split(" ")[0] || targetName || t('myReportsScreen.defaultUserName');
    if (
      confirm &&
      !window.confirm(t('reportBlockSheet.confirmBlock', { name: label }))
    ) {
      return false;
    }

    try {
      const { error: blockError } = await sb.from("blocks").insert({
        blocker_id: authUser.id,
        blocked_id: targetId,
      });
      if (blockError && blockError.code !== "23505") throw blockError;

      setBlocked((prev) => [...new Set([...prev, targetId].filter(Boolean))]);
      if (active) setActive(null);
      void refetchTables();
      showToast(t('reportBlockSheet.blockSuccessToast'));
      setBlockPromptFor(null);
      setProfileView(null);
      return true;
    } catch (err) {
      console.error("Block failed:", err);
      showToast(t('reportBlockSheet.blockFailedToast'));
      return false;
    }
  };

  const handleChangePassword = async (e) => {
    e?.preventDefault?.();
    if (changeNewPassword.length < 6) {
      showToast(t('changePasswordScreen.minLengthToast'));
      return;
    }
    if (changeNewPassword !== changeConfirmPassword) {
      showToast(t('changePasswordScreen.mismatchToast'));
      return;
    }
    setChangingPassword(true);
    try {
      const { error: reauthError } = await sb.auth.signInWithPassword({
        email: authUser.email,
        password: changeCurrentPassword,
      });
      if (reauthError) {
        showToast(t('changePasswordScreen.wrongCurrentToast'));
        setChangingPassword(false);
        return;
      }
      const { error } = await sb.auth.updateUser({ password: changeNewPassword });
      if (error) throw error;
      showToast(t('changePasswordScreen.successToast'));
      setScreen("main");
      setChangeCurrentPassword("");
      setChangeNewPassword("");
      setChangeConfirmPassword("");
    } catch (err) {
      showToast(t('changePasswordScreen.failedToast'));
      console.error(err);
    } finally {
      setChangingPassword(false);
    }
  };

  const handleUnblock = async (blockedUserId) => {
    if (!authUser?.id || !blockedUserId) return;
    if (!window.confirm(t('blockedUsersScreen.confirmUnblock'))) return;

    try {
      const { error } = await sb
        .from("blocks")
        .delete()
        .eq("blocker_id", authUser.id)
        .eq("blocked_id", blockedUserId);
      if (error) throw error;

      setBlockedUsers((prev) => prev.filter((b) => b.blocked_id !== blockedUserId));
      setBlocked((prev) => prev.filter((id) => id !== blockedUserId));
      showToast(t('blockedUsersScreen.unblockSuccessToast'));
      void refetchTables();
    } catch (err) {
      showToast(t('blockedUsersScreen.unblockFailedToast'));
      console.error(err);
    }
  };

  const submitReport = async () => {
    const target = reportFor;
    const name = target?.name;
    const reportedId = target?.id;
    if (!authUser?.id || !reportedId || !reportReason) {
      showToast(t('reportBlockSheet.reportMissingProfileToast'));
      return;
    }

    try {
      const { error: reportError } = await sb.from("reports").insert({
        reporter_id: authUser.id,
        reported_id: reportedId,
        reason: reportReason,
        table_id: active || null,
      });
      if (reportError) throw reportError;

      if (reportBlock) {
        await blockUser(reportedId, name, { confirm: false });
      } else {
        setBlockPromptFor({ id: reportedId, name });
      }

      void pushNotif('reportSubmitted', {}, "");
      showToast(reportBlock ? t('reportBlockSheet.reportSuccessAndBlockedToast') : t('reportBlockSheet.reportSuccessToast'));
    } catch (err) {
      console.error("Report failed:", err);
      showToast(t('reportBlockSheet.reportFailedToast'));
    }

    setReportFor(null);
    setReportReason(null);
    setReportBlock(false);
  };

  const leaveTable = async (id) => {
    if (!window.confirm(t('appMisc.leaveTableConfirm'))) return;
    try {
      await apiLeaveTable(id);
      setTickets((prev) => { const p = { ...prev }; delete p[id]; return p; });
      await refetchTables();
      const lt = tables.find((x) => x.id === id);
      showToast(isRide(lt) ? t('toasts.leftRide') : t('toasts.leftTableNoRefund'));
    } catch (err) {
      showToast(mapErr(err));
    }
  };

  /* ── Nikoqiri: aprovo / refuzo (live via useRequests) ── */
  const approveRequest = async (tableId, rid) => {
    try {
      await approveRequestLive(tableId, rid);
      await refetchTables();
      void pushNotif('requestApproved', {}, "");
      showToast(t('toasts.requestApproved'));
    } catch (err) {
      showToast(mapErr(err));
    }
  };

  const rejectRequest = async (tableId, rid) => {
    try {
      await rejectRequestLive(tableId, rid);
      await refetchTables();
      showToast(t('toasts.requestRejected'));
    } catch (err) {
      showToast(mapErr(err));
    }
  };

  const sendMsg = async (textOverride) => {
    const text = (textOverride ?? msg).trim();
    if (!text || !active) return;
    setMsg("");
    try {
      // useChat already binds tableId from `active`
      await sendChatMsg(text);
    } catch (err) {
      console.error("Send failed:", err);
      showToast(t('toasts.messageSendFailed'));
    }
  };
  /* ── Përkthimi via Edge Function (çelësi Anthropic mbetet në server) ── */
  const [translations, setTranslations] = useState({});
  const [draftTranslating, setDraftTranslating] = useState(false);

  const translateMsg = async (tableId, idx, text) => {
    const key = tableId + '-' + idx;
    if (translations[key] && translations[key] !== '...') return;
    setTranslations(tr => ({ ...tr, [key]: '...' }));
    try {
      const { translateText } = await import('./api/translate');
      const result = await translateText(text, {
        viewerLangs: profile.langs,
        tableLangs: activeTable?.langs,
        browserLocale: typeof navigator !== 'undefined' ? navigator.language : undefined,
      });
      setTranslations(tr => ({ ...tr, [key]: result }));
    } catch (err) {
      setTranslations(tr => ({ ...tr, [key]: null }));
      showToast(mapErr(err));
    }
  };

  const translateDraft = async () => {
    if (!msg.trim() || draftTranslating) return;
    setDraftTranslating(true);
    try {
      const { translateText, resolveDraftTarget } = await import('./api/translate');
      const target = resolveDraftTarget(msg.trim(), {
        viewerLangs: profile.langs,
        tableLangs: activeTable?.langs,
      });
      const result = await translateText(msg.trim(), {
        target,
        viewerLangs: profile.langs,
        tableLangs: activeTable?.langs,
        browserLocale: typeof navigator !== 'undefined' ? navigator.language : undefined,
      });
      setMsg(result);
      showToast(t('toasts.translationReady'));
    } catch (err) {
      showToast(mapErr(err));
    } finally {
      setDraftTranslating(false);
    }
  };

  /* Zari e vendos pyetjen në fushë — përdoruesi e sheh, e ndryshon po deshi, pastaj e dërgon vetë */
  const throwIcebreaker = () => {
    const items = t('icebreakers')
    const list = Array.isArray(items) ? items : []
    const pick = list[Math.floor(Math.random() * list.length)] || ''
    setMsg(pick)
  };

  const openWedQuiz = () => {
    setQuizStep(0);
    setQuizAns([]);
    setWedLangSel([]);
    setWedShowOtherInput(false);
    setWedOtherText('');
    setMatchState(wedStatus?.signup ? "signed" : "quiz");
    setShowWed(true);
    plansApi.myWednesday().then(applyWedStatus).catch(() => {});
  };

  /* ── Kuizi → regjistrim për të mërkurën. Grupet e vërteta (6 persona) formohen
        të martën 20:00 nga serveri; Premium kanë përparësi. ── */
  const [wedStatus, setWedStatus] = useState(null);
  const applyWedStatus = useCallback((res) => {
    setWedStatus(res || null);
    const sgn = res?.signup;
    if (sgn?.table_id) wedTableId.current = sgn.table_id;
    if (sgn?.group_id) wedTableGroupId.current = sgn.group_id;
    return sgn;
  }, []);
  useEffect(() => {
    if (!authUser?.id) { setWedStatus(null); return; }
    plansApi.myWednesday().then(applyWedStatus).catch(() => {});
  }, [authUser?.id, applyWedStatus]);

  const runWedMatching = (ans) => {
    if (typeof window !== 'undefined') {
      try { window.__lastWedQuizAns = ans; } catch (_) { /* ignore */ }
    }
    setMatchState("matching");
    (async () => {
      try {
        const selectedCity = (basicLocked && homeCity) || city || "Prishtinë";
        const langs = buildWedQuizTableLangs(ans[4]);
        const res = await plansApi.signupWednesday(selectedCity, langs);
        applyWedStatus(res);
        setMatchState("signed");
        setWedDone(true);
      } catch (err) {
        setMatchState("quiz");
        showToast(mapErr(err));
      }
    })();
  };

  const cancelWedSignup = async () => {
    try {
      await plansApi.cancelWednesday();
      applyWedStatus(await plansApi.myWednesday());
      setShowWed(false);
      setMatchState("quiz");
      setWedDone(false);
    } catch (err) { showToast(mapErr(err)); }
  };

  const advanceWedQuizAnswer = (value) => {
    const ans = [...quizAns, value];
    setQuizAns(ans);
    setWedShowOtherInput(false);
    setWedOtherText('');
    if (ans.length < QUIZ.length) {
      setQuizStep(quizStep + 1);
      return;
    }
    runWedMatching(ans);
  };

  const answerWedQuiz = (code) => {
    if (code === 'other') {
      setWedShowOtherInput(true);
      setWedOtherText('');
      return;
    }
    setWedShowOtherInput(false);
    setWedOtherText('');
    advanceWedQuizAnswer(code);
  };

  const submitWedOtherAnswer = () => {
    const fallback = t('wednesdayQuiz.otherOption');
    advanceWedQuizAnswer(wedOtherText.trim() || fallback);
  };

  const completeWedLangQuestion = () => {
    if (!wedLangSel.length) return;
    const ans = [...quizAns, [...wedLangSel]];
    setQuizAns(ans);
    runWedMatching(ans);
  };

  const openWedTable = () => {
    setShowWed(false);
    setMatchState("quiz");
    setQuizStep(0);
    setQuizAns([]);
    setWedLangSel([]);
    setWedShowOtherInput(false);
    setWedOtherText('');
    if (wedTableId.current) { setActive(wedTableId.current); setTab("imet"); }
  };

  /* ── Vlerësimi pas takimit ── */
  const submitRating = async () => {
    const picks = [...rateSelect];
    const rT = tables.find((t) => t.id === rateFor);
    if (!authUser?.id || !rateFor || rateStars < 1 || rateAgain === null) {
      showToast(t('toasts.ratingIncomplete'));
      return;
    }

    try {
      const { error: ratingError } = await sb.from("ratings").insert({
        table_id: rateFor,
        rater_id: authUser.id,
        stars: rateStars,
        meet_again: rateAgain,
      });
      if (ratingError) throw ratingError;

      // connection_picks — UUIDs only; mutual match via DB trigger check_mutual_pick
      if (picks.length > 0) {
        const pickRows = picks
          .filter((pickedId) => pickedId && pickedId !== authUser.id)
          .map((pickedId) => ({
            table_id: rateFor,
            picker_id: authUser.id,
            picked_id: pickedId,
          }));
        if (pickRows.length > 0) {
          const { error: pickError } = await sb.from("connection_picks").insert(pickRows);
          if (pickError) throw pickError;
        }
      }

      if (rT && profile.done) {
        const delta = (rateStars - 3) * 4;
        const nextScore = Math.max(-40, Math.min(40, (aff[rT.cat] || 0) + delta));
        const { error: affError } = await sb.from("affinity").upsert(
          {
            user_id: authUser.id,
            category: rT.category || rT.cat,
            score: nextScore,
          },
          { onConflict: "user_id,category" },
        );
        if (affError) console.error("Affinity upsert failed:", affError);
        else setAff((a) => ({ ...a, [rT.cat]: nextScore }));
      }

      setRated((p) => ({ ...p, [rateFor]: rateStars }));
      awardBadge("first-rate", "", t('badges.firstRate'));
      showToast(t('toasts.ratingSaved'));
    } catch (err) {
      console.error("Rating failed:", err);
      showToast(t('toasts.ratingFailed'));
    }

    setRateFor(null);
    setRateStars(0);
    setRateAgain(null);
    setRateSelect([]);
  };

  /* Foto e profilit */
  /* ── Kontrolli i fytyrës: refuzon foto të zeza / një ngjyrë / pa fytyrë ── */
  const validatePhoto = (dataUrl) => new Promise((resolve) => {
    const img = new window.Image();
    img.onload = async () => {
      try {
        const c = document.createElement("canvas");
        const w = (c.width = Math.min(180, img.width));
        const h = (c.height = Math.min(180, img.height));
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0, sum2 = 0, skin = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          sum += l; sum2 += l * l;
          if (r > 60 && g > 35 && b > 25 && r > b && Math.abs(r - g) > 8) skin++;
        }
        const mean = sum / n;
        const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
        if (mean < 26) return resolve({ ok: false, code: 'too_dark' });
        if (sd < 16) return resolve({ ok: false, code: 'too_flat' });
        if ("FaceDetector" in window) {
          try {
            const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
            const faces = await fd.detect(img);
            if (!faces.length) return resolve({ ok: false, code: 'no_face' });
            return resolve({ ok: true, faceChecked: true });
          } catch (err) { /* bie te heuristika */ }
        }
        if (skin / n < 0.03) return resolve({ ok: false, code: 'no_face' });
        resolve({ ok: true });
      } catch (err) { resolve({ ok: true }); }
    };
    img.onerror = () => resolve({ ok: false, code: 'read_error' });
    img.src = dataUrl;
  });

  const dataUrlToJpegFile = async (dataUrl) => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], "avatar.jpg", { type: blob.type || "image/jpeg" });
  };

  /** Queue locally during onboarding; upload only after a Supabase session exists. */
  const flushPendingAvatar = useCallback(async (expectedUserId = registrationUserId) => {
    const file = pendingAvatarFile.current;
    if (!file || avatarFlushing.current || !expectedUserId) return null;
    avatarFlushing.current = true;
    try {
      const path = await uploadAvatar(file, expectedUserId);
      await saveAvatarToProfile(path, expectedUserId);
      pendingAvatarFile.current = null;
      console.log("[ejaBashkohu] Avatar uploaded successfully:", path);
      setUser((u) => ({ ...u, photoPath: path }));
      void reloadProfile();
      return path;
    } catch (avatarErr) {
      console.error("[ejaBashkohu] Avatar upload failed after signup:", avatarErr);
      throw avatarErr;
    } finally {
      avatarFlushing.current = false;
    }
  }, [reloadProfile, registrationUserId]);

  // After step-1 signup: flush queued avatar only for THIS registration's user id
  useEffect(() => {
    if (!authUser?.id || !registrationUserId || !pendingAvatarFile.current) return;
    if (authUser.id !== registrationUserId) return;
    let cancelled = false;
    (async () => {
      setUser((u) => ({ ...u, photoUploading: true }));
      try {
        const path = await flushPendingAvatar(registrationUserId);
        if (cancelled) return;
        setUser((u) => ({
          ...u,
          ...(path ? { photoPath: path } : {}),
          photoUploading: false,
        }));
      } catch {
        if (!cancelled) {
          setUser((u) => ({ ...u, photoUploading: false }));
          showToast(t('toasts.photoUploadFailed'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.id, registrationUserId, flushPendingAvatar, showToast]);

  const onPhotoPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!registrationUserId || authUser?.id !== registrationUserId) {
      showToast(t('onboarding.step3.sessionMismatch'));
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setUser((u) => ({ ...u, photoUploading: true }));

      const validation = await validatePhoto(dataUrl);
      if (!validation.ok) {
        setPhotoError(t(photoErrorKey(validation.code)));
        // Keep previous photo if one exists — do not clear on rejection
        setUser((u) => ({ ...u, photoUploading: false }));
        showToast(t('onboarding.step3.toastRejected'));
        return;
      }

      setPhotoError(null);
      setUser((u) => ({ ...u, photo: dataUrl, photoUploading: false }));

      // Queue for upload AFTER signup (no session on step 3)
      try {
        pendingAvatarFile.current = await dataUrlToJpegFile(dataUrl);
        showToast(validation.faceChecked ? t('onboarding.step3.toastFaceOk') : t('onboarding.step3.toastAccepted'));
      } catch (err) {
        console.error("File conversion failed:", err);
        pendingAvatarFile.current = null;
      }
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  /* Rregullimi i anës: kamerat selfie shpesh e kthejnë foton si pasqyrë */
  const flipPhoto = async () => {
    if (!user.photo || user.photoUploading) return;
    const img = new window.Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.translate(img.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      const flippedDataUrl = c.toDataURL("image/jpeg", 0.92);
      setUser((u) => ({ ...u, photo: flippedDataUrl }));

      fetch(flippedDataUrl)
        .then((r) => r.blob())
        .then((blob) => {
          pendingAvatarFile.current = new File([blob], "avatar.jpg", { type: "image/jpeg" });
        })
        .catch((err) => console.error("Flip file update failed:", err));
    };
    img.src = user.photo;
  };

  const validateEventDateTime = () => {
    if (!form.eventDate || !form.eventTime) {
      showToast(t('createTable.toastPickDateTime'));
      return false;
    }
    if (!isFutureEventDatetime(form.eventDate, form.eventTime)) {
      showToast(t('createTable.toastFutureTime'));
      return false;
    }
    return true;
  };

  const createTable = async () => {
    const ride = form.mode === "vozitje";
    const trip = form.mode === "udhetim";
    const sportMode = form.mode === "sport";
    if (sportMode && !SPORTS.includes(form.sport)) { showToast(t('sports.pickSportRequired')); return; }
    if (trip && !form.cafe.trim()) { showToast(t('createTable.toastDestinationRequired')); return; }
    if (!ride && !trip && !form.cafe.trim()) { showToast(t('createTable.toastVenueRequired')); return; }
    if (ride && form.city === form.toCity) { showToast(t('createTable.toastDifferentCities')); return; }
    if (!validateEventDateTime()) return;
    if (!(form.mapsLink || '').trim()) {
      showToast(t('createTable.toastMapsRequired'));
      return;
    }
    if (!isValidMapsLink(form.mapsLink)) {
      showToast(t('createTable.toastMapsInvalid'));
      return;
    }

    const eventDatetime = buildEventDatetime(form.eventDate, form.eventTime);
    if (!eventDatetime) {
      showToast(t('createTable.toastDateTimeInvalid'));
      return;
    }
    const timeLabel = formatEventTime(eventDatetime, locale);

    const langs = (Array.isArray(form.langs) ? form.langs : []).filter(Boolean);
    const tags = ride
      ? ['shared_ride']
      : trip
        ? ['group_trip']
        : (form.womenOnly ? ['women_only'] : form.menOnly ? ['men_only'] : []);

    const payload = {
      kind: ride ? "vozitje" : trip ? "udhetim" : sportMode ? "sport" : "tavoline",
      category: ride ? "vozitje" : trip ? "udhetim" : sportMode ? "sport" : form.cat,
      title: ride ? `${form.city} → ${form.toCity}` : form.cafe.trim(),
      area: ride
        ? t('feed.areaDeparture', { place: form.area.trim() || t('createTable.defaultAreaCenter') })
        : trip
          ? t('feed.areaDepartureCity', { city: form.city })
          : (form.area.trim() || t('feed.areaCenter')),
      city: basicLocked && homeCity ? homeCity : form.city,
      to_city: ride ? form.toCity : null,
      budget: trip ? ((form.budget || "").trim() || null) : null,
      time_label: timeLabel,
      event_datetime: eventDatetime,
      starts_at: eventDatetime,
      spots: Number(form.spots) || 4,
      ...(form.mode === "tavoline" || sportMode ? { women_only: !!form.womenOnly, men_only: !!form.menOnly } : {}),
      ...(sportMode ? { sport: form.sport, skill_level: SKILL_LEVELS.includes(form.level) ? form.level : "any" } : {}),
      langs: langs.length ? langs : ["sq"],
      tags,
      description: form.desc.trim() || (ride ? t('feed.defaultDescRide') : trip ? t('feed.defaultDescTrip') : sportMode ? t('sports.defaultDesc') : t('feed.defaultDescTable')),
      maps_link: form.mapsLink.trim() || null,
    };

    try {
      await apiCreateTable(payload);
      awardBadge("first-host", "", t('badges.firstHost'));
      if (sportMode) { setCat("sport"); setSportFilter(form.sport); }
      void reloadPlan();
      setCity(form.city); setTab("zbulo"); setShowCreate(false);
      setForm(defaultCreateForm());
      await refetchTables();
      showToast(ride ? t('createTable.toastRideOpened') : trip ? t('createTable.toastTripOpened') : sportMode ? t('sports.toastOpened') : t('createTable.toastTableOpened'));
    } catch (err) {
      console.error("[ejaBashkohu] Table creation failed:", err);
      showToast(mapErr(err));
    }
  };

  // Auth redirects + hydrate local profile from Supabase session
  useEffect(() => {
    if (loading || profileLoading) return;
    if (!authUser && (screen === "main" || screen === "admin" || screen === "blocked-users" || screen === "change-password" || screen === "my-reports")) setScreen("onboard");
    if (authUser && screen === "onboard" && !pendingEmailConfirmation && !passwordRecovery) {
      // Mid-registration: stay on onboarding steps, do not hijack to feed
      if (step > 0 && registrationUserId && authUser.id === registrationUserId) return;
      if (dbProfile && !isOnboardingComplete(dbProfile)) return;
      if (loadPendingRegistration()?.userId === authUser.id) return;
      void handlePostLogin(authUser.id, { preferStored: true });
    }
  }, [authUser, loading, profileLoading, screen, pendingEmailConfirmation, passwordRecovery, handlePostLogin, step, registrationUserId, dbProfile]);

  // Landing footer → privacy / terms overlays
  useEffect(() => {
    const onShowPolicy = (e) => {
      const which = e?.detail;
      if (which === 'privacy' || which === 'terms') setShowPolicy(which);
    };
    window.addEventListener('showPolicy', onShowPolicy);
    return () => window.removeEventListener('showPolicy', onShowPolicy);
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const meta = authUser.user_metadata || {};
    setUser((u) => ({
      ...u,
      email: authUser.email || u.email,
      firstName: meta.first_name || u.firstName || "",
      lastName: meta.last_name || u.lastName || "",
      age: meta.age != null ? String(meta.age) : u.age,
      name:
        [meta.first_name, meta.last_name].filter(Boolean).join(" ") ||
        u.name ||
        (authUser.email ? authUser.email.split("@")[0] : u.name),
    }));
  }, [authUser]);

  // Resume onboarding after email confirmation (same tab or fresh load via link)
  useEffect(() => {
    if (loading || profileLoading || !authUser?.id || pendingEmailConfirmation || passwordRecovery) return;

    const tryResume = async () => {
      if (dbProfile && isOnboardingComplete(dbProfile)) {
        clearPendingRegistration();
        return;
      }

      if (step >= 1 && step <= 4 && registrationUserId === authUser.id) return;

      // Google / Apple: the account exists but name, age, photo and terms are not
      // done yet, so start at step 1 (name only, prefilled) and run every step.
      const provider = socialProviderOf(authUser);
      if (provider) {
        let row = dbProfile;
        if (!row) {
          const { data } = await sb.from('profiles')
            .select('first_name, last_name, age, user_preferences, onboarded_at')
            .eq('id', authUser.id).maybeSingle();
          row = data;
        }
        if (row && isOnboardingComplete(row)) return;
        const meta = authUser.user_metadata || {};
        const clean = (v) => (v && v !== 'Përdorues' && v !== '-' ? v : '');
        const full = (meta.full_name || meta.name || '').trim();
        setRegistrationUserId(authUser.id);
        setSocialOnboarding(provider);
        setUser((prev) => ({
          ...prev,
          email: authUser.email || prev.email,
          firstName: clean(row?.first_name) || meta.given_name || full.split(' ')[0] || '',
          lastName: clean(row?.last_name) || meta.family_name || full.split(' ').slice(1).join(' ') || '',
          age: '',
        }));
        setAgreedToTerms(false);
        setScreen('onboard');
        setShowSignIn(false);
        setStep(1);
        return;
      }

      const pending = loadPendingRegistration();
      if (pending?.userId && pending.userId !== authUser.id) return;

      const confirmed = !!(authUser.email_confirmed_at || authUser.confirmed_at);
      if (!confirmed) return;

      let firstName = pending?.firstName;
      let lastName = pending?.lastName;
      let email = pending?.email ?? authUser.email ?? '';
      let age = pending?.age;

      let profileRow = dbProfile;
      if (!firstName && !profileRow) {
        const { data } = await sb
          .from('profiles')
          .select('first_name, last_name, age, user_preferences, onboarded_at')
          .eq('id', authUser.id)
          .maybeSingle();
        profileRow = data;
      }

      if (profileRow && isOnboardingComplete(profileRow)) {
        clearPendingRegistration();
        return;
      }

      if (!firstName && profileRow) {
        firstName = profileRow.first_name;
        lastName = profileRow.last_name;
        age = String(profileRow.age ?? '24');
      }

      if (!firstName) return;

      setRegistrationUserId(authUser.id);
      setUser((prev) => ({
        ...prev,
        firstName: firstName ?? prev.firstName,
        lastName: lastName ?? prev.lastName,
        email,
        age: age ?? prev.age,
        name: `${firstName ?? ''} ${lastName ?? ''}`.trim(),
      }));
      setScreen('onboard');
      setStep(2);
      setShowSignIn(false);
    };

    void tryResume();
  }, [
    authUser?.id,
    dbProfile,
    loading,
    profileLoading,
    pendingEmailConfirmation,
    passwordRecovery,
    step,
    registrationUserId,
  ]);

  const completeStep1Registration = async () => {
    setAuthError(null);
    const trimmedEmail = user.email.trim();

    if (!isEmailFormatValid(trimmedEmail)) {
      setAuthError(t('onboarding.errors.emailInvalid'));
      return;
    }

    setAuthBusy(true);
    try {
      const domainCheck = await checkEmailDomain(trimmedEmail);
      if (!domainCheck.valid) {
        setAuthError(t('onboarding.errors.domainInvalid'));
        return;
      }

      await signOut();
      setRegistrationUserId(null);
      const result = await signUp(
        trimmedEmail,
        password,
        user.firstName.trim(),
        user.lastName.trim(),
        user.age || '18',
      );

      if (result.needsEmailConfirmation) {
        const uid = result.user?.id;
        if (uid) {
          setRegistrationUserId(uid);
          savePendingRegistration({
            userId: uid,
            email: trimmedEmail,
            firstName: user.firstName.trim(),
            lastName: user.lastName.trim(),
            age: user.age || '18',
          });
        }
        return;
      }

      const uid = result.user?.id;
      if (!uid) throw new Error(t('errors.registrationFailed'));

      setRegistrationUserId(uid);
      setUser((prev) => ({
        ...prev,
        name: `${prev.firstName.trim()} ${prev.lastName.trim()}`,
      }));
      setStep(2);
    } catch (err) {
      setAuthError(mapErr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const finishOnboardingProfile = async (nextUser) => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      const uid = registrationUserId;
      if (!uid || authUser?.id !== uid) {
        throw new Error(t('onboarding.registration.sessionMismatch'));
      }

      if (pendingAvatarFile.current) {
        try {
          setUser((u) => ({ ...u, photoUploading: true }));
          await flushPendingAvatar(uid);
        } finally {
          setUser((u) => ({ ...u, photoUploading: false }));
        }
      }

      // Server validates name + age (18+) and marks onboarding complete; until then
      // the DB refuses hosting/joining (applies to email and Google/Apple sign-ups).
      const { error: onboardErr } = await sb.rpc('complete_onboarding', {
        p_first_name: (nextUser.firstName || '').trim(),
        p_last_name: (nextUser.lastName || '').trim(),
        p_age: parseInt(nextUser.age, 10) || 18,
        p_is_tourist: nextUser.isTourist === true,
        p_from_place: nextUser.isTourist ? (nextUser.from?.trim() || null) : null,
      });
      if (onboardErr) throw onboardErr;
      if (socialOnboarding) {
        // keep auth metadata in sync so the header shows the chosen name
        void sb.auth.updateUser({ data: { first_name: nextUser.firstName.trim(), last_name: nextUser.lastName.trim() } });
      }

      setSocialOnboarding(null);
      setRegistrationUserId(null);
      clearPendingRegistration();
      setStep(0);
      await handlePostLogin(uid, { preferStored: false });
      setTimeout(() => openMatchQuiz(0), 600);
    } catch (err) {
      const msg = mapErr(err);
      setAuthError(msg);
      if (/regjistruar tashmë|sesioni nuk përputhet/i.test(msg)) {
        setSignInEmail(nextUser.email.trim());
        setRegistrationUserId(null);
        pendingAvatarFile.current = null;
        setStep(0);
        setShowSignIn(true);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleResendConfirmEmail = async () => {
    if (resendCooldown > 0) return;
    const email = user.email.trim();
    if (!email) return;
    setAuthError(null);
    setAuthBusy(true);
    setResendCooldown(60);
    try {
      await resendSignupConfirmation(email);
      showToast(t('onboarding.confirmEmail.resendSuccess'));
    } catch (err) {
      setAuthError(mapErr(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleChangeConfirmEmail = () => {
    clearPendingRegistration();
    clearPendingEmailConfirmation();
    setRegistrationUserId(null);
    setAuthError(null);
    setResendCooldown(0);
    setStep(1);
    setScreen('onboard');
    setShowSignIn(false);
  };

  const handleSocialSignIn = async (provider) => {
    setAuthError(null);
    setOauthBusy(provider);
    try {
      await signInWithProvider(provider); // browser navigates away on success
    } catch (err) {
      setAuthError(mapErr(err));
      setOauthBusy(null);
    }
  };

  const socialButtons = (
    <div className="social-auth">
      <button type="button" className="social-btn google" disabled={!!oauthBusy} onClick={() => void handleSocialSignIn('google')}>
        {oauthBusy === 'google' ? t('social.redirecting') : t('social.continueGoogle')}
      </button>
      <button type="button" className="social-btn apple" disabled={!!oauthBusy} onClick={() => void handleSocialSignIn('apple')}>
        {oauthBusy === 'apple' ? t('social.redirecting') : t('social.continueApple')}
      </button>
      <div className="social-or"><span>{t('social.or')}</span></div>
    </div>
  );

  const handleSignIn = async (e) => {
    e?.preventDefault?.();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const session = await signIn(signInEmail.trim(), signInPassword);
      setShowSignIn(false);
      setForgotPassword(false);
      setForgotSent(false);
      setStep(0);
      if (session?.user?.id) {
        await handlePostLogin(session.user.id, { preferStored: false });
      } else {
        setScreen("main");
      }
    } catch (err) {
      setAuthError(mapErr(err));
      // Keep the user on a sign-in surface so a failed password never
      // resurfaces mid-onboarding steps (vendas/turist, etc.).
      setShowSignIn(true);
      setStep(0);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e?.preventDefault?.();
    if (resetCooldown > 0) {
      setAuthError(t('errors.passwordResetRateLimit', { seconds: resetCooldown }));
      return;
    }
    setAuthError(null);
    const email = signInEmail.trim();
    if (!email) {
      setAuthError(t('errors.enterEmail'));
      return;
    }
    setAuthBusy(true);
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setForgotSent(true);
      setResetCooldown(60);
    } catch (err) {
      setAuthError(mapErr(err));
      const waitSec = parseResetRateLimitSeconds(err);
      if (waitSec) setResetCooldown(waitSec);
    } finally {
      setAuthBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="app onboard hero-bg">
        <Style />
        <div className="hero">
          <h1 className="logo-word hero-logo">eja<span className="logo-bang">Bashkohu</span></h1>
          <div className="spinner" style={{ width: 28, height: 28, borderColor: "rgba(255,255,255,.35)", borderTopColor: "#FF6B35" }} />
          <p className="hero-foot">{t('app.loading')}</p>
        </div>
      </div>
    );
  }

  if (passwordRecovery && authUser) {
    return (
      <div className="app onboard hero-bg">
        <Style />
        <div className="hero hero-login">
          <h1 className="logo-word hero-logo">eja<span className="logo-bang">Bashkohu</span></h1>
          <form className="ob-card" style={{ width: "100%", maxWidth: 340 }} onSubmit={submitNewPassword}>
            <p className="ob-q" style={{ color: "#1E2432" }}>{t('passwordRecovery.title')}</p>
            <PasswordInput
              className="input xl"
              placeholder={t('passwordRecovery.placeholder')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
            />
            <button className="btn primary full" type="submit" disabled={newPasswordBusy}>
              {newPasswordBusy ? t('passwordRecovery.saveBusy') : t('passwordRecovery.saveBtn')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (pendingEmailConfirmation) {
    const confirmEmail = user.email.trim() || signInEmail.trim();
    return (
      <div className="app onboard hero-bg">
        <Style />
        <div className="hero">
          <div className="hero-ring">
            <SeatRing total={6} taken={4} size={92} />
          </div>
          <h1 className="logo-word hero-logo">eja<span className="logo-bang">Bashkohu</span></h1>
          <h2 className="hero-line">{t('onboarding.confirmEmail.title')}</h2>
          <p className="hero-stats" style={{ textAlign: "center", maxWidth: 320 }}>
            <span>{t('onboarding.confirmEmail.body', { email: confirmEmail })}</span>
          </p>
          <div className="ob-card" style={{ width: "100%", maxWidth: 340 }}>
            {authError && <p className="age-warn">{authError}</p>}
            <button
              className="btn primary full big-cta"
              type="button"
              disabled={authBusy || resendCooldown > 0}
              onClick={() => { void handleResendConfirmEmail(); }}
            >
              {authBusy
                ? t('onboarding.confirmEmail.resendBusy')
                : resendCooldown > 0
                  ? t('onboarding.confirmEmail.resendCooldown', { seconds: resendCooldown })
                  : t('onboarding.confirmEmail.resendBtn')}
            </button>
            <button
              className="btn ghost full"
              type="button"
              style={{ marginTop: 10 }}
              onClick={handleChangeConfirmEmail}
            >
              {t('onboarding.confirmEmail.changeEmail')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showDeactivatedGate && authUser) {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="app-mobile-frame">
            <div className="reactivate-overlay">
              <div className="reactivate-card">
                <LanguageSwitcher className="centered" />
                <p className="reactivate-title">{t('deactivatedGate.title')}</p>
                <p>{t('deactivatedGate.body')}</p>
                <button
                  className="btn primary full"
                  type="button"
                  onClick={async () => {
                    setShowDeactivatedGate(false);
                    await startRegistration();
                  }}
                >
                  {t('deactivatedGate.newAccountCta')}
                </button>
              </div>
            </div>
            {toast && <div className="toast">{toast}</div>}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════ ADMIN PANEL ══════════ */
  if (screen === 'admin' && isAdmin) {
    // Full-width console (desktop sidebar, mobile drawer); not inside the phone frame.
    return (
      <AdminPanel
        isAdmin={isAdmin}
        adminId={authUser?.id}
        onViewAsUser={() => setAdminScreen('main')}
        onSignOut={() => { if (window.confirm(t('profile.confirmSignOut'))) void handleSignOut(); }}
      />
    );
  }

  /* ══════════ ONBOARDING — stili Timeleft: 1 pyetje për ekran ══════════ */
  if (screen === "onboard") {
    const totalSteps = 4;
    return (
      <div className="app-shell">
        {showPolicy === 'privacy' && (
          <div className="policy-overlay">
            <PrivacyPolicy onBack={() => setShowPolicy(null)} />
          </div>
        )}
        {showPolicy === 'terms' && (
          <div className="policy-overlay">
            <TermsOfService onBack={() => setShowPolicy(null)} />
          </div>
        )}
        <div className="app-main">
          <div className={`app-mobile-frame is-hero`}>
            <div className={`app onboard ${step === 0 && showSignIn ? "hero-bg" : ""} ${step === 0 && !showSignIn ? "landing-host" : ""} ${step > 0 ? "onboard-steps-host" : ""}`}>
              <Style />

              {/* ── LANDING (SEO). Logged-out, step 0 ── */}
              {!authUser && step === 0 && !showSignIn && confirmLinkExpired && (
                <div className="reset-expired-banner" style={{ margin: '16px auto 0' }}>
                  <p>{t('onboarding.confirmEmail.linkExpiredBody')}</p>
                  <button
                    className="btn primary full"
                    type="button"
                    onClick={() => {
                      setConfirmLinkExpired(false);
                      void startRegistration();
                    }}
                  >
                    {t('onboarding.confirmEmail.linkExpiredRegisterCta')}
                  </button>
                </div>
              )}

              {!authUser && step === 0 && !showSignIn && (
                <LandingPage
                  onGetStarted={() => { void startRegistration(); }}
                  onSignIn={() => { setStep(0); setShowSignIn(true); setAuthError(null); }}
                />
              )}
              {step === 0 && <WhatsAppButton variant="landing" context={showSignIn ? 'sign-in' : 'landing'} />}

              {step === 0 && showSignIn && (
                <div className="hero hero-login">
                  <div className="hero-top">
                    <div className="hero-ring">
                      <SeatRing total={6} taken={4} size={92} />
                    </div>
                    <h1 className="logo-word hero-logo">eja<span className="logo-bang">Bashkohu</span></h1>
                    <LanguageSwitcher className="on-dark centered" />
                  </div>

                  {resetLinkExpired && !forgotPassword && (
                    <div className="reset-expired-banner">
                      <p>{t('auth.resetLinkExpiredBody')}</p>
                      <button
                        className="btn primary full"
                        type="button"
                        onClick={() => {
                          setResetLinkExpired(false);
                          setForgotPassword(true);
                          setForgotSent(false);
                          setAuthError(null);
                        }}
                      >
                        {t('auth.resetLinkExpiredCta')}
                      </button>
                    </div>
                  )}

                  {confirmLinkExpired && !forgotPassword && (
                    <div className="reset-expired-banner">
                      <p>{t('onboarding.confirmEmail.linkExpiredBody')}</p>
                      <button
                        className="btn primary full"
                        type="button"
                        onClick={() => {
                          setConfirmLinkExpired(false);
                          void startRegistration();
                        }}
                      >
                        {t('onboarding.confirmEmail.linkExpiredRegisterCta')}
                      </button>
                    </div>
                  )}

                  {forgotPassword ? (
                    <form className="ob-card" style={{ width: "100%", maxWidth: 340 }} onSubmit={handleForgotPassword}>
                      <p className="ob-q" style={{ color: "#1E2432" }}>{t('auth.resetTitle')}</p>
                      {forgotSent ? (
                        <p className="step-hint" style={{ textAlign: "center" }}>
                          {t('auth.resetSent')}
                        </p>
                      ) : (
                        <>
                          <input
                            className="input xl"
                            type="email"
                            placeholder={t('auth.emailPlaceholder')}
                            value={signInEmail}
                            onChange={(e) => setSignInEmail(e.target.value)}
                            required
                            autoFocus
                          />
                          {authError && <p className="age-warn">{authError}</p>}
                          <button className="btn primary full" type="submit" disabled={authBusy || resetCooldown > 0}>
                            {authBusy
                              ? t('auth.resetSendBusy')
                              : resetCooldown > 0
                                ? t('auth.resetCooldown', { seconds: resetCooldown })
                                : t('auth.resetSendButton')}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => { setForgotPassword(false); setForgotSent(false); setAuthError(null); }}
                      >
                        {t('auth.resetBackToSignIn')}
                      </button>
                    </form>
                  ) : (
                    <form className="ob-card" style={{ width: "100%", maxWidth: 340 }} onSubmit={handleSignIn}>
                      <p className="ob-q" style={{ color: "#1E2432" }}>{t('auth.signInTitle')}</p>
                      {socialButtons}
                      <input
                        className="input xl"
                        type="email"
                        placeholder={t('auth.emailPlaceholder')}
                        value={signInEmail}
                        onChange={(e) => setSignInEmail(e.target.value)}
                        required
                        autoFocus
                      />
                      <PasswordInput
                        className="input xl"
                        placeholder={t('auth.passwordPlaceholder')}
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        required
                        minLength={6}
                      />
                      <button
                        className="forgot-link"
                        onClick={() => { setAuthError(null); setForgotPassword(true); setForgotSent(false); }}
                        type="button"
                      >
                        {t('auth.forgotPassword')}
                      </button>
                      {authError && <p className="age-warn">{authError}</p>}
                      <button className="btn primary full" type="submit" disabled={authBusy}>
                        {authBusy ? t('auth.signInBusy') : t('auth.signInButton')}
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          setShowSignIn(false);
                          setForgotPassword(false);
                          setForgotSent(false);
                          setAuthError(null);
                        }}
                      >
                        {t('auth.back')}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* ── HAPAT: 1–4 në kartë të bardhë mbi gradient ── */}
              {step > 0 && !showSignIn && (
                <div className="onboard-shell">
                  <button
                    type="button"
                    className="onboard-shell-back"
                    onClick={() => { setAuthError(null); setStep(step - 1); }}
                  >
                    {t('onboarding.back')}
                  </button>
                  <div className="onboard-card">
                    <div className="onboard-header">
                      <div className="onboard-logo">
                        eja<span className="logo-bang">Bashkohu</span>
                      </div>
                      <LanguageSwitcher className="on-dark compact" />
                      <div className="onboard-progress">
                        {[1, 2, 3, 4].map((n) => (
                          <div key={n} className={`progress-dot ${step >= n ? 'active' : ''}`} />
                        ))}
                      </div>
                    </div>

                    {step === 1 && socialOnboarding && (
                      <div className="step-body">
                        <h2 className="step-title">{t('social.stepTitle')}</h2>
                        <p className="step-sub">{t('social.stepSub', { provider: socialOnboarding === 'apple' ? 'Apple' : 'Google', email: user.email || '' })}</p>
                        <div className="input-group">
                          <input className="input modern" placeholder={t('onboarding.step1.firstNameLabel')} value={user.firstName}
                            onChange={(e) => setUser({ ...user, firstName: e.target.value })} autoFocus maxLength={40} />
                          <input className="input modern" placeholder={t('onboarding.step1.lastNameLabel')} value={user.lastName}
                            onChange={(e) => setUser({ ...user, lastName: e.target.value })} maxLength={40} />
                        </div>
                        <div className="terms-row">
                          <input type="checkbox" id="terms-check-social" checked={agreedToTerms}
                            onChange={(e) => setAgreedToTerms(e.target.checked)} className="terms-checkbox" />
                          <label htmlFor="terms-check-social" className="terms-label">
                            {t('onboarding.step1.termsText')}{' '}
                            <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPolicy('terms'); }}>{t('onboarding.step1.termsLink')}</button>
                            {' '}{t('onboarding.step1.termsAnd')}{' '}
                            <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPolicy('privacy'); }}>{t('onboarding.step1.privacyLink')}</button>
                          </label>
                        </div>
                        {authError && <p className="age-warn">{authError}</p>}
                        <button type="button" className="btn primary full modern-btn"
                          disabled={!user.firstName.trim() || !user.lastName.trim() || !agreedToTerms}
                          onClick={() => {
                            setUser((u) => ({ ...u, name: `${u.firstName.trim()} ${u.lastName.trim()}`, age: u.age || '24' }));
                            setAuthError(null);
                            setStep(2);
                          }}>
                          {t('onboarding.step1.continueBtn')}
                        </button>
                        <button type="button" className="onboard-signin-link"
                          onClick={async () => { setSocialOnboarding(null); setRegistrationUserId(null); await signOut(); setStep(0); }}>
                          <span>{t('social.otherAccount')}</span>
                        </button>
                      </div>
                    )}

                    {step === 1 && !socialOnboarding && (
                      <div className="step-body">
                        <h2 className="step-title">{t('onboarding.step1.title')}</h2>
                        <p className="step-sub">{t('onboarding.step1.stepSub')}</p>
                        {socialButtons}

                        <div className="input-group">
                          <input
                            className="input modern"
                            placeholder={t('onboarding.step1.firstNameLabel')}
                            value={user.firstName}
                            onChange={(e) => setUser({ ...user, firstName: e.target.value })}
                            autoFocus
                          />
                          <input
                            className="input modern"
                            placeholder={t('onboarding.step1.lastNameLabel')}
                            value={user.lastName}
                            onChange={(e) => setUser({ ...user, lastName: e.target.value })}
                          />
                          <input
                            className="input modern"
                            type="email"
                            placeholder={t('onboarding.step1.emailLabel')}
                            value={user.email}
                            onChange={(e) => setUser({ ...user, email: e.target.value })}
                          />
                          <PasswordInput
                            placeholder={t('onboarding.step1.passwordLabel')}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              if (
                                authBusy ||
                                !user.firstName.trim() ||
                                !user.lastName.trim() ||
                                !emailValid ||
                                !passwordValid ||
                                !agreedToTerms
                              ) return;
                              e.preventDefault();
                              void completeStep1Registration();
                            }}
                          />
                          <p className="input-hint password-requirements">
                            {t('onboarding.step1.passwordRequirements')}
                          </p>
                        </div>

                        <p className="input-hint">
                          {t('onboarding.step1.emailHint')}
                        </p>

                        <div className="terms-row">
                          <input
                            type="checkbox"
                            id="terms-check"
                            checked={agreedToTerms}
                            onChange={(e) => setAgreedToTerms(e.target.checked)}
                            className="terms-checkbox"
                          />
                          <label htmlFor="terms-check" className="terms-label">
                            {t('onboarding.step1.termsText')}{' '}
                            <button
                              type="button"
                              className="link-btn"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPolicy('terms'); }}
                            >
                              {t('onboarding.step1.termsLink')}
                            </button>
                            {' '}{t('onboarding.step1.termsAnd')}{' '}
                            <button
                              type="button"
                              className="link-btn"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPolicy('privacy'); }}
                            >
                              {t('onboarding.step1.privacyLink')}
                            </button>
                          </label>
                        </div>
                        {authError && <p className="age-warn">{authError}</p>}
                        <button
                          type="button"
                          className="btn primary full modern-btn"
                          disabled={
                            authBusy ||
                            !user.firstName.trim() ||
                            !user.lastName.trim() ||
                            !emailValid ||
                            !(password?.length >= 6) ||
                            !agreedToTerms
                          }
                          onClick={() => {
                            void completeStep1Registration();
                          }}
                        >
                          {authBusy ? t('onboarding.step1.continueBusy') : t('onboarding.step1.continueBtn')}
                        </button>
                        <button
                          type="button"
                          className="onboard-signin-link"
                          onClick={() => { setStep(0); setShowSignIn(true); setAuthError(null); }}
                        >
                          {t('onboarding.step1.hasAccount')} <span>{t('onboarding.step1.signInLink')}</span>
                        </button>
                      </div>
                    )}

                    {step === 2 && (() => {
                      const a = parseInt(user.age, 10) || 24;
                      const setA = (v) => setUser({ ...user, age: String(Math.max(18, Math.min(99, v))) });
                      const captionKey =
                        a < 25 ? 'under25' :
                        a < 32 ? 'under32' :
                        a < 45 ? 'under45' :
                        a < 60 ? 'under60' : 'default';
                      return (
                        <div className="step-body">
                          <h2 className="step-title">{t('onboarding.step2.title')}</h2>
                          <p className="step-sub">{t('onboarding.step2.stepSub')}</p>
                          <div className="age-stage">
                            <button type="button" className="age-btn" onClick={() => setA(a - 1)} disabled={a <= 18} aria-label={t('onboarding.step2.decreaseAria')}>−</button>
                            <div className="age-big-wrap">
                              <span className="age-big">{a}</span>
                              <span className="age-unit">{t('onboarding.step2.ageUnit')}</span>
                            </div>
                            <button type="button" className="age-btn plus" onClick={() => setA(a + 1)} disabled={a >= 99} aria-label={t('onboarding.step2.increaseAria')}>+</button>
                          </div>
                          <input type="range" min="18" max="80" value={Math.min(a, 80)} className="age-slider"
                            onChange={(e) => setA(Number(e.target.value))} aria-label={t('onboarding.step2.ageSliderAria')} />
                          <div className="age-scale"><span>18</span><span>30</span><span>45</span><span>60</span><span>80+</span></div>
                          <p className="age-caption">{t(`onboarding.step2.captions.${captionKey}`)}</p>
                          <button type="button" className="btn primary full modern-btn" disabled={!registrationUserId || authUser?.id !== registrationUserId} onClick={async () => {
                            if (registrationUserId && authUser?.id === registrationUserId) {
                              const age = parseInt(user.age, 10) || 18;
                              await sb.from('profiles').update({ age }).eq('id', registrationUserId);
                            }
                            setStep(3);
                          }}>{t('onboarding.step2.continueBtn')}</button>
                          <p className="step-hint center">{t('onboarding.step2.stepHint')}</p>
                        </div>
                      );
                    })()}

                    {step === 3 && (
                      <div className="step-body">
                        <h2 className="step-title">{t('onboarding.step3.title')}</h2>
                        <p className="step-sub">{t('onboarding.step3.stepSub')}</p>
                        <div className="photo-preview-wrap">
                          {user.photo
                            ? <img src={user.photo} alt={t('onboarding.step3.photoAlt')} className="photo-preview" />
                            : (
                              <button
                                type="button"
                                className="photo-placeholder"
                                onClick={() => fileRef.current?.click()}
                                aria-label={t('onboarding.step3.addPhotoAria')}
                              >
                                <Camera size={32} />
                              </button>
                            )}
                          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhotoPick} />
                          <div className="photo-actions">
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() => fileRef.current?.click()}
                              disabled={user.photoUploading}
                            >
                              <Camera size={16} /> {user.photoUploading ? t('onboarding.step3.uploadingText') : user.photo ? t('onboarding.step3.changeBtn') : t('onboarding.step3.pickBtn')}
                            </button>
                            {user.photo && (
                              <button
                                type="button"
                                className="btn ghost"
                                onClick={flipPhoto}
                                disabled={user.photoUploading}
                                title={t('onboarding.step3.flipBtn')}
                              >
                                <FlipHorizontal size={16} /> {user.photoUploading ? t('onboarding.step3.uploadingText') : t('onboarding.step3.flipBtn')}
                              </button>
                            )}
                          </div>
                        </div>
                        {photoError && (
                          <div className="photo-error-block">
                            <p className="age-warn">{photoError}</p>
                            <button
                              type="button"
                              className="btn ghost full"
                              onClick={() => setStep(4)}
                            >
                              {t('onboarding.step3.continueAnywayBtn')}
                            </button>
                          </div>
                        )}
                        <p className="step-hint">{t('onboarding.step3.hint')}{user.photo ? t('onboarding.step3.hintWithPhoto') : ''}</p>
                        <button
                          type="button"
                          className="btn primary full modern-btn"
                          disabled={!user.photo || user.photoUploading}
                          onClick={() => setStep(4)}
                        >
                          {user.photoUploading ? t('onboarding.step3.uploadingText') : t('onboarding.step3.continueBtn')}
                        </button>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="step-body">
                        <h2 className="step-title">{t('onboarding.step4.title')}</h2>
                        <p className="step-sub">{t('onboarding.step4.stepSub')}</p>
                        <div className="choice-grid">
                          <button type="button" className={`choice big ${user.isTourist === false ? "on" : ""}`}
                            disabled={authBusy}
                            onClick={() => {
                              const next = { ...user, isTourist: false };
                              setUser(next);
                              finishOnboardingProfile(next);
                            }}>
                            {t('onboarding.step4.localBtn')}
                          </button>
                          <button type="button" className={`choice big ${user.isTourist === true ? "on" : ""}`}
                            disabled={authBusy}
                            onClick={() => setUser({ ...user, isTourist: true })}>
                            {t('onboarding.step4.touristBtn')}
                          </button>
                        </div>
                        {user.isTourist && (
                          <>
                            <input className="input modern" autoFocus placeholder={t('onboarding.step4.touristPlaceholder')} value={user.from}
                              onChange={(e) => setUser({ ...user, from: e.target.value })}
                              onKeyDown={(e) => e.key === "Enter" && !authBusy && finishOnboardingProfile(user)} />
                            <button type="button" className="btn primary full modern-btn" disabled={authBusy}
                              onClick={() => finishOnboardingProfile(user)}>
                              {authBusy ? t('onboarding.step4.registering') : t('onboarding.step4.joinBtn')}
                            </button>
                          </>
                        )}
                        {authError && <p className="age-warn">{authError}</p>}
                        {authBusy && user.isTourist === false && <p className="step-hint center">{t('onboarding.step4.registering')}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════ NDRYSHO FJALËKALIMIN ══════════ */
  if (screen === "change-password") {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="app-mobile-frame">
            <div className="app change-password-screen">
              <Style />
              <button
                type="button"
                className="back-btn"
                onClick={() => {
                  setScreen("main");
                  setChangeCurrentPassword("");
                  setChangeNewPassword("");
                  setChangeConfirmPassword("");
                }}
              >
                {t('onboarding.back')}
              </button>
              <h2 className="change-password-title">{t('changePasswordScreen.title')}</h2>
              <form className="change-password-form" onSubmit={(e) => void handleChangePassword(e)}>
                <PasswordInput
                  placeholder={t('changePasswordScreen.currentPasswordLabel')}
                  value={changeCurrentPassword}
                  onChange={(e) => setChangeCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <PasswordInput
                  placeholder={t('changePasswordScreen.newPasswordLabel')}
                  value={changeNewPassword}
                  onChange={(e) => setChangeNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <PasswordInput
                  placeholder={t('changePasswordScreen.confirmPasswordLabel')}
                  value={changeConfirmPassword}
                  onChange={(e) => setChangeConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button className="btn primary full" type="submit" disabled={changingPassword}>
                  {changingPassword ? t('changePasswordScreen.changingText') : t('changePasswordScreen.submitBtn')}
                </button>
              </form>
              {toast && <div className="toast">{toast}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════ RAPORTIMET E MIA ══════════ */
  if (screen === "my-reports") {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="app-mobile-frame">
            <div className="app my-reports-screen">
              <Style />
              <button type="button" className="back-btn" onClick={() => setScreen("main")}>
                {t('onboarding.back')}
              </button>
              <h2 className="my-reports-title">{t('myReportsScreen.title')}</h2>

              {loadingReports && <p className="my-reports-loading">{t('myReportsScreen.loading')}</p>}

              {!loadingReports && myReports.length === 0 && (
                <p className="empty-state my-reports-empty">{t('myReportsScreen.emptyState')}</p>
              )}

              {!loadingReports && myReports.map((r) => (
                <div key={r.id} className="my-report-row">
                  <p className="reported-name">
                    {[r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") || t('myReportsScreen.defaultUserName')}
                  </p>
                  <p className="reason">{displayReportReason(r.reason)}</p>
                  <p className="status">{translateReportStatus(r.status)}</p>
                  <p className="date">{formatBlockDate(r.created_at, locale)}</p>
                </div>
              ))}
              {toast && <div className="toast">{toast}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════ PËRDORUESIT E BLLOKUAR ══════════ */
  if (screen === "blocked-users") {
    return (
      <div className="app-shell">
        <div className="app-main">
          <div className="app-mobile-frame">
            <div className="app blocked-users-screen">
              <Style />
              <button
                type="button"
                className="back-btn"
                onClick={() => setScreen("main")}
              >
                {t('onboarding.back')}
              </button>
              <h2 className="blocked-users-title">{t('blockedUsersScreen.title')}</h2>

              {loadingBlocked && <p className="blocked-users-loading">{t('blockedUsersScreen.loading')}</p>}

              {!loadingBlocked && blockedUsers.length === 0 && (
                <div className="empty-state blocked-users-empty">
                  <p>{t('blockedUsersScreen.emptyState')}</p>
                </div>
              )}

              {!loadingBlocked && blockedUsers.map((b) => (
                <div key={b.blocked_id} className="blocked-user-row">
                  <div className="blocked-user-info">
                    <Avatar
                      name={b.displayName}
                      photo={b.photo}
                      small
                    />
                    <div>
                      <p className="name">{b.displayName}</p>
                      <p className="date">{t('blockedUsersScreen.blockedOnLabel', { date: formatBlockDate(b.created_at, locale) })}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-unblock"
                    onClick={() => void handleUnblock(b.blocked_id)}
                  >
                    {t('blockedUsersScreen.unblockBtn')}
                  </button>
                </div>
              ))}
              {toast && <div className="toast">{toast}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════ APLIKACIONI KRYESOR ══════════ */
  return (
    <div className="app-shell">
      <div className="app-sidebar">
        <div className="sidebar-logo">
          <span className="logo-word">eja<span className="logo-bang">Bashkohu</span></span>
          <p className="sidebar-tag">{t('feed.tagline')}</p>
        </div>
        <nav className="sidebar-nav">
          <button
            type="button"
            className={tab === "zbulo" ? "sb-btn on" : "sb-btn"}
            onClick={() => setTab("zbulo")}
          >
            {t('feed.discover')}
          </button>
          <button
            type="button"
            className={tab === "imet" ? "sb-btn on" : "sb-btn"}
            onClick={() => setTab("imet")}
          >
            {t('feed.myTables')}
            {myTables.length > 0 && <span className="sb-badge">{myTables.length}</span>}
          </button>
          <button
            type="button"
            className={tab === "mesime" ? "sb-btn on" : "sb-btn"}
            onClick={() => setTab("mesime")}
          >
            {t('lessons.title')}
          </button>
        </nav>
        {tab !== "mesime" && (
        <button type="button" className="btn primary sidebar-cta" onClick={openCreate}>
          + {createFabLabel()}
        </button>
        )}
      </div>
      <div className="app-main">
        <div className="app-mobile-frame">
          <div className="app">
            <Style />

            {isAdmin && screen === 'main' && (
              <button
                type="button"
                className="admin-return-badge"
                onClick={() => setAdminScreen('admin')}
              >
                {t('admin.backToAdmin')}
              </button>
            )}

            <header className="hdr">
        <div className="hdr-art"><CityScape variant={cityVariant(city)} tone="light" height={64} /></div>
        <div className="hdr-top">
          <h1 className="logo-word sm">eja<span className="logo-bang">Bashkohu</span></h1>
          <div className="hdr-right">
            {plansReady && plan && (
              <button type="button" className={`premium-pill ${isPremium ? '' : 'basic'}`} onClick={() => setShowPlans(true)}>
                {isPremium ? `★ ${t('plans.premium')}` : t('plans.goPremium')}
              </button>
            )}
            <button
              className="bell"
              onClick={() => {
                const opening = !showNotifs;
                setShowNotifs(opening);
                if (opening) {
                  void markRead();
                  setUnread(0);
                }
              }}
              aria-label={t('feed.notifications')}
            >
              <Bell size={19} />
              {unread > 0 && <em className="bell-badge">{unread}</em>}
            </button>
            <div
              className="hdr-user"
              role="button"
              tabIndex={0}
              title={t('feed.profileTitle')}
              style={{ cursor: "pointer" }}
              onClick={() => setProfileView({
                id: authUser?.id,
                name: user.name,
                age: user.age,
                from: user.isTourist ? (user.from || t('feed.tourist')) : t('feed.kosovo'),
                photo: user.photo,
                langs: profile.langs?.length ? profile.langs : ["Shqip"],
                isMe: true,
              })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setProfileView({
                    id: authUser?.id,
                    name: user.name,
                    age: user.age,
                    from: user.isTourist ? (user.from || t('feed.tourist')) : t('feed.kosovo'),
                    photo: user.photo,
                    langs: profile.langs?.length ? profile.langs : ["Shqip"],
                    isMe: true,
                  });
                }
              }}
            >
              <Avatar name={user.name} photo={user.photo} small />
              <span>{user.firstName}{user.age ? `, ${user.age}` : ""}</span>
            </div>
          </div>
        </div>
        {showLocationBanner && locationSuggestedCity && (
          <div className="location-banner">
            <p>
              {t('feed.locationBanner', { city: locationSuggestedCity })}
            </p>
            <div className="location-banner-actions">
              <button className="btn primary sm" type="button" onClick={() => {
                setCity(locationSuggestedCity);
                setShowLocationBanner(false);
              }}>
                {t('feed.locationYes')}
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setShowLocationBanner(false)}>
                {t('feed.locationNo')}
              </button>
            </div>
          </div>
        )}
        <div className="city-row">
          {visibleCities.map((c) => (
            <button key={c} className={`chip city ${city === c ? "on" : ""}`} onClick={() => setCity(c)}>{c}</button>
          ))}
          {basicLocked && (
            <button type="button" className="chip city locked" onClick={() => setShowPlans(true)}>
              🔒 {t('plans.allCitiesLocked')}
            </button>
          )}
        </div>

        {showNotifs && (
          <div className="notif-panel">
            <div className="notif-hdr">
              <strong>{t('feed.notifications')}</strong>
              <span className="notif-actions">
                <button
                  type="button"
                  className="notif-clear"
                  onClick={() => {
                    void clearNotifs();
                    void markRead();
                  }}
                >
                  {t('feed.notifClear')}
                </button>
                <button className="clear" onClick={() => setShowNotifs(false)} aria-label={t('feed.close')}><X size={13} /></button>
              </span>
            </div>
            <p className="email-line">{t('feed.notifEmailLine')} <strong>{user.email || "-"}</strong></p>
            {notifs.length === 0 && <p className="muted small pad">{t('feed.notifEmpty')}</p>}
            {notifs.map((n) => (
              <div key={n.id} className="notif-item">
                <span className="notif-icon" aria-hidden="true" />
                <p>{notifText(n, t, locale)}</p>
                <em>{n.time}</em>
              </div>
            ))}
          </div>
        )}
      </header>

      <main className="content">
        {tab === "zbulo" && (
          <>
            {!tasteDone && (
              <button className="mq-banner" onClick={() => openMatchQuiz(0)}>
                <span className="mq-txt"><strong>{t('feed.tasteQuizBanner')}</strong>, {t('feed.tasteQuizBannerSub')}</span>
                <span className="wed-cta">{t('feed.tasteQuizCta')}</span>
              </button>
            )}
            {tasteDone && !wedDone && city === "Prishtinë" && (
              <button className="wed-banner" onClick={openWedQuiz}>
                <div className="wed-left">
                  <span className="wed-kicker">{t('feed.wednesdayKicker')}</span>
                  <strong>{t('feed.wednesdayTitle')}</strong>
                  <span className="wed-sub">{t('feed.wednesdaySub')}</span>
                </div>
                <span className="wed-cta">{t('feed.tasteQuizCta')}</span>
              </button>
            )}
            <div className="search">
              <Search size={16} />
              <input placeholder={t('feed.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && <button className="clear" onClick={() => setQuery("")} aria-label={t('feed.clear')}><X size={14} /></button>}
            </div>
            <div className="browse-modes" role="tablist" aria-label={t('browse.label')}>
              {["tables", "sport", "lessons", "trips", "rides"].map((m) => (
                <button key={m} type="button" role="tab" aria-selected={feedMode === m}
                  className={`browse-mode ${feedMode === m ? "on" : ""}`} onClick={() => setFeedMode(m)}>
                  {t(`browse.${m}`)}
                </button>
              ))}
            </div>
            {feedMode === "tables" && (
            <div className="cat-row">
              <button className={`chip ${cat === "all" ? "on" : ""}`} onClick={() => setCat("all")}>
                {t('feed.categoryAll')}
              </button>
              {CATEGORIES.filter((c) => !["sport", "vozitje", "udhetim"].includes(c.id)).map((c) => (
                  <button key={c.id} className={`chip ${cat === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>
                    {catLabel(c.id)}
                  </button>
              ))}
            </div>
            )}
            {cat === "sport" && (() => {
              const inCity = tables.filter((x) => x.cat === "sport" && x.city === city && !blocked.includes(x.host_id));
              const count = (sp) => inCity.filter((x) => x.sport === sp).length;
              return (
                <div className="cat-row sport-row" role="tablist" aria-label={t('sports.pickSport')}>
                  <button className={`chip ${sportFilter === "all" ? "on" : ""}`} onClick={() => setSportFilter("all")}>
                    {t('sports.allSports')} <span className="chip-count">{inCity.length}</span>
                  </button>
                  {SPORTS.map((sp) => (
                    <button key={sp} className={`chip ${sportFilter === sp ? "on" : ""}`} onClick={() => setSportFilter(sp)}>
                      {t(`sports.list.${sp}`)} <span className="chip-count">{count(sp)}</span>
                    </button>
                  ))}
                </div>
              );
            })()}

            {!tablesLoading && !tablesError && (
              <p className="count"><span className="live-dot" aria-hidden="true" />{t(`browse.count.${feedMode}`, { count: filtered.length, city })} <span className="live-label">{t('browse.live')}</span></p>
            )}

            {tablesLoading && (
              <div className="cards" aria-busy="true" aria-label={t('feed.loadingTables')}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="card" style={{ pointerEvents: "none", opacity: 0.7 }}>
                    <div className="card-left">
                      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#E8DFCC" }} />
                      <div style={{ width: 40, height: 10, borderRadius: 6, background: "#EDE4D0", marginTop: 6 }} />
                    </div>
                    <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ height: 16, width: "70%", borderRadius: 8, background: "#E8DFCC" }} />
                      <div style={{ height: 12, width: "55%", borderRadius: 8, background: "#EDE4D0" }} />
                      <div style={{ height: 36, width: "100%", borderRadius: 8, background: "#F3EBDA" }} />
                      <div style={{ height: 12, width: "40%", borderRadius: 8, background: "#EDE4D0" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!tablesLoading && tablesError && (
              <div className="feed-error-state" role="alert">
                <div className="feed-error-icon" aria-hidden="true">!</div>
                <p className="feed-error-title">{t('feed.feedErrorTitle')}</p>
                <p className="feed-error-sub">
                  {t('feed.feedErrorSub')}
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => { void refetchTables(); }}
                >
                  {t('feed.retry')}
                </button>
              </div>
            )}

            {!tablesLoading && !tablesError && filtered.length === 0 && (
              <div className="empty">
                <SeatRing total={5} taken={0} size={56} />
                {cat === "sport" && sportFilter !== "all" ? (
                  <p><strong>{t('sports.emptySport', { sport: t(`sports.list.${sportFilter}`), city })}</strong></p>
                ) : (<>
                  <p><strong>{t('feed.emptyFeedTitle')}</strong></p>
                  <p className="muted">{t('feed.emptyFeedSub')}</p>
                </>)}
                <button className="btn primary" onClick={openCreate}><Plus size={16} /> {createFabLabel()}</button>
              </div>
            )}

            {!tablesLoading && !tablesError && (
            <div className="cards">
              {filtered.map((tbl, idx) => {
                const st = myStatus(tbl);
                const m = tbl._match;
                const mCls = m == null ? "" : m >= 85 ? "hot" : m >= 70 ? "warm" : "cool";
                return (
                  <article key={tbl.id} className={`card ${idx === 0 && m >= 85 ? "rec" : ""}`} onClick={() => setActive(tbl.id)}>
                    {idx === 0 && m >= 85 && <span className="rec-ribbon">{t('feed.recommended')}</span>}
                    <div className="card-left">
                      <SeatRing total={tbl.spots} taken={tbl.joined.length} />
                      <span className={`seats-label ${st === "full" ? "full" : ""}`}>
                        {st === "full" ? t('feed.seatsFull') : t('feed.seatsCount', { count: tbl.spots - tbl.joined.length })}
                      </span>
                      {m != null && <span className={`match-pill ${mCls}`}>{m}%</span>}
                    </div>
                    <div className="card-body">
                      <div className="card-top">
                        <h3>{tbl.cafe}</h3>
                        {st === "joined" && <span className="badge joined"><Check size={12} /> {t('feed.statusJoined')}</span>}
                        {st === "pending" && <span className="badge pending"><Hourglass size={11} /> {t('feed.statusPending')}</span>}
                        {st === "waitlist" && <span className="badge pending"><BellRing size={11} /> {t('feed.statusWaitlist')}</span>}
                        {st === "approved" && <span className="badge approved">{t('feed.statusApproved')}</span>}
                        {st === "host" && <span className="badge hosting">{t('feed.statusHosting')}{(tbl.requests || []).filter(r=>r.status==="pending").length > 0 ? t('feed.statusHostingRequests', { count: tbl.requests.filter(r=>r.status==="pending").length }) : ""}</span>}
                      </div>
                      <p className="meta"><MapPin size={13} /> {tbl.area} · <Clock size={13} /> {tbl.time}</p>
                      {tbl.womenOnly && tbl.cat !== "vozitje" && tbl.cat !== "udhetim" && (
                        <span className="badge women">{t('feed.badgeWomenOnly')}</span>
                      )}
                      {tbl.menOnly && tbl.cat !== "vozitje" && tbl.cat !== "udhetim" && (
                        <span className="badge men">{t('feed.badgeMenOnly')}</span>
                      )}
                      {isRide(tbl) && <span className="badge ride">{t('feed.badgeRide')}</span>}
                      {tbl.sport && (
                        <span className="badge sport">
                          {t(`sports.list.${tbl.sport}`)} · {t('sports.playersBadge', { count: tbl.spots })}
                          {tbl.skillLevel && tbl.skillLevel !== "any" ? ` · ${t(`sports.levels.${tbl.skillLevel}`)}` : ""}
                        </span>
                      )}
                      {tbl.cat === "udhetim" && <span className="badge trip">{tbl.budget || t('feed.badgeTrip')}</span>}
                      <p className="desc">{localizeTableDescription(tbl.desc, t)}</p>
                      <div className="card-foot">
                        <span className="host" onClick={(e) => { e.stopPropagation(); setProfileView(hostProf(tbl)); }} role="button" title={t('feed.viewProfile')}>
                          <Avatar name={tbl.host} small /> {tbl.host}
                          {tbl.hostVerified && <BadgeCheck size={14} className="verified" />}
                          <Stars rating={tbl.hostRating} />
                        </span>
                        <span className="langs"><Globe size={12} /> {formatLangs(tbl.langs)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            )}
          </>
        )}

        {tab === "mesime" && (
          <Lessons key={lessonsView.key} initialView={lessonsView.view} authUser={authUser} cities={CITIES} city={city} showToast={showToast} mapErr={mapErr} myName={user.name} />
        )}

        {tab === "imet" && (
          <>
            {badges.length > 0 && (
              <div className="conn-strip">
                <p className="label">{t('feed.myBadges')}</p>
                <div className="badge-row">
                  {badges.filter((b) => BADGE_LABEL_KEY[b]).map((b) => (
                    <span key={b} className="badge-chip">{t(`badges.${BADGE_LABEL_KEY[b]}`)}</span>
                  ))}
                </div>
              </div>
            )}
            {connections.length > 0 && (
              <div className="conn-strip">
                <p className="label">{t('feed.myConnections')}</p>
                <div className="conn-list">
                  {connections.map((c) => {
                    const name = typeof c === "string" ? c : c.name;
                    const id = typeof c === "string" ? null : c.id;
                    return (
                      <button key={id || name} className="conn-chip" onClick={() => setProfileView(liteProf(name, id))}>
                        <Avatar name={name} /> <span>{name.split(" ")[0]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <h2 className="section-title">{t('feed.myTables')}</h2>
            {myTables.length === 0 ? (
              <div className="empty">
                <SeatRing total={4} taken={1} size={56} />
                <p><strong>{t('feed.emptyMyTablesTitle')}</strong></p>
                <p className="muted">{t('feed.emptyMyTablesSub')}</p>
                <button className="btn ghost" onClick={() => setTab("zbulo")}>{t('feed.discoverTablesBtn')}</button>
              </div>
            ) : (
              <div className="cards">
                {myTables.map((tbl) => {
                  const st = myStatus(tbl);
                  const pend = (tbl.requests || []).filter((r) => r.status === "pending").length;
                  return (
                    <article key={tbl.id} className="card slim" onClick={() => setActive(tbl.id)}>
                      <SeatRing total={tbl.spots} taken={tbl.joined.length} size={40} />
                      <div className="card-body">
                        <h3>{tbl.cafe} <span className="muted small">· {tbl.city}</span></h3>
                        <p className="meta"><Clock size={13} /> {tbl.time} · <Users size={13} /> {tbl.joined.length}/{tbl.spots}</p>
                        {st === "host" && <span className="badge hosting">{t('feed.statusHosting')}{pend > 0 ? t('feed.statusHostingNewRequests', { count: pend }) : ""}</span>}
                        {(tbl.isExpired || isTableExpired(tbl.event_datetime)) && st === "host" && (
                          <span className="badge expired">{t('feed.statusExpired')}</span>
                        )}
                        {st === "pending" && <span className="badge pending"><Hourglass size={11} /> {t('feed.statusPendingApproval')}</span>}
                        {st === "approved" && <span className="badge approved">{t('feed.statusApprovedPay')}</span>}
                        {tickets[tbl.id] && <span className="badge ticket-mini"><Ticket size={11} /> {tickets[tbl.id]}</span>}
                        {st === "joined" && !rated[tbl.id] && (
                          <button className="rate-btn" onClick={(e) => { e.stopPropagation(); setRateFor(tbl.id); }}>
                            <Star size={12} /> {t('feed.rateExperience')}
                          </button>
                        )}
                        {rated[tbl.id] && <span className="badge joined">{t('feed.rated', { rating: rated[tbl.id] })}</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {tab !== "mesime" && (
      <button className="fab" onClick={openCreate} aria-label={createFabLabel()}>
        <Plus size={22} /> {createFabLabel()}
      </button>
      )}

      <WhatsAppButton email={authUser?.email} context={tab} />

      {showPlans && plan && (
        <PlansSheet plan={plan} email={authUser?.email} showToast={showToast} mapErr={mapErr}
          onClose={() => setShowPlans(false)} onChanged={reloadPlan}
          onChangeCity={() => { setShowPlans(false); setShowCityPicker(true); }} />
      )}
      {plansReady && plan && ((!isPremium && !homeCity) || showCityPicker) && (
        <HomeCityPicker cities={CITIES} initial={homeCity || city} showToast={showToast} mapErr={mapErr}
          canClose={!!homeCity} onClose={() => setShowCityPicker(false)}
          onSaved={async (c) => { setShowCityPicker(false); setCity(c); await reloadPlan(); await refetchTables(); }} />
      )}

      <nav className="nav">
        <button className={tab === "zbulo" ? "on" : ""} onClick={() => setTab("zbulo")}>
          <Coffee size={20} /><span>{t('feed.discover')}</span>
        </button>
        <button className={tab === "imet" ? "on" : ""} onClick={() => setTab("imet")}>
          <Users size={20} /><span>{t('feed.myTables')}</span>
          {(myTables.length > 0 || pendingRequestsForMe > 0) && (
            <em className="nav-count">{pendingRequestsForMe > 0 ? pendingRequestsForMe : myTables.length}</em>
          )}
        </button>
        <button className={tab === "mesime" ? "on" : ""} onClick={() => setTab("mesime")}>
          <BookOpen size={20} /><span>{t('lessons.title')}</span>
        </button>
      </nav>

      {/* ══════════ DETAJI I TAVOLINËS ══════════ */}
      {activeTable && !payFor && (() => {
        const st = myStatus(activeTable);
        const tableExpired = activeTable.isExpired || isTableExpired(activeTable.event_datetime);
        // Source of truth while sheet is open: live useRequests subscription
        const pendingReqs = pendingRequests;
        return (
          <div className="sheet-wrap" onClick={() => setActive(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-art"><CityScape variant={cityVariant(activeTable.city)} tone="light" height={66} /></div>
              <div className="sheet-hdr">
                <button className="icon-btn" onClick={() => setActive(null)} aria-label={t('tableDetail.close')}><ChevronLeft size={20} /></button>
                <div>
                  <h2>{activeTable.cafe}</h2>
                  {activeTable.sport && (
                    <span className="badge sport">
                      {t(`sports.list.${activeTable.sport}`)} · {t('sports.playersBadge', { count: activeTable.spots })}
                      {activeTable.skillLevel ? ` · ${t(`sports.levels.${activeTable.skillLevel}`)}` : ""}
                    </span>
                  )}
                  <p className="meta"><MapPin size={13} /> {activeTable.area}, {activeTable.city} · <Clock size={13} /> {activeTable.time}</p>
                  {(activeTable.langs || []).length > 0 && (
                    <p className="meta langs"><Globe size={12} /> {formatLangs(activeTable.langs)}</p>
                  )}
                </div>
                <SeatRing total={activeTable.spots} taken={activeTable.joined.length} size={48} />
              </div>

              {/* ── RESTORANTI SEKRET (Darka e së Mërkurës) ── */}
              {tableExpired && (
                <div className="table-expired-banner" role="status">
                  {t('tableDetail.tableExpired')}
                </div>
              )}

              {activeTable.mystery && (
                revealChecked && restaurant?.revealed ? (
                  <div className="restaurant-reveal">
                    <p className="reveal-name">{restaurant.name}</p>
                    <p className="reveal-addr">{restaurant.address}</p>
                  </div>
                ) : revealChecked ? (
                  <div className="restaurant-locked">
                    <p>{t('tableDetail.restaurantLocked')}</p>
                  </div>
                ) : null
              )}

              {/* ── LOKACIONI ── */}
              {(!activeTable.mystery || restaurant?.revealed) && (
              <div className="loc-row">
                <a
                  className="btn ghost btn-sm"
                  href={
                    activeTable.mystery && restaurant?.revealed
                      ? wednesdayMapsUrl(restaurant)
                      : mapsUrlForTable(activeTable)
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MapPin size={14} /> {t('tableDetail.openInMaps')}
                </a>
              </div>
              )}

              {/* Bileta */}
              {tickets[activeTable.id] && (
                <div className="ticket">
                  <div className="ticket-left">
                    <Ticket size={22} />
                    <div><strong>{t('tableDetail.yourTicket')}</strong><span className="ticket-code">{tickets[activeTable.id]}</span></div>
                  </div>
                  <span className="ticket-note">{t('tableDetail.showTicketCode')}</span>
                </div>
              )}

              {/* ── KËRKESAT (vetëm kur TI je nikoqiri) ── */}
              {st === "host" && (
                <div className="requests">
                  <p className="label">{t('tableDetail.requestsTitle', { count: pendingReqs.length })}</p>
                  {pendingReqs.length === 0 ? (
                    <p className="muted small">{t('tableDetail.requestsEmpty')}</p>
                  ) : pendingReqs.map((r) => (
                    <div
                      key={r.rid}
                      className="req-card"
                      onClick={() => setProfileView({
                        id: r.user_id,
                        name: r.name,
                        age: r.age,
                        from: r.from || t('feed.kosovo'),
                        photo: r.photo,
                      })}
                      role="button"
                      title={t('tableDetail.viewFullProfile')}
                    >
                      <Avatar name={r.name} photo={r.photo} large />
                      <div className="req-info">
                        <strong>{r.name}, {r.age}</strong>
                        <span className="muted small">{r.from || t('feed.kosovo')}</span>
                      </div>
                      <div className="req-actions">
                        <button className="btn-approve" onClick={(e) => { e.stopPropagation(); approveRequest(activeTable.id, r.rid); }} aria-label={t('tableDetail.approveAria', { name: r.name })}>
                          <UserCheck size={16} /> {t('tableDetail.approve')}
                        </button>
                        <button className="btn-reject" onClick={(e) => { e.stopPropagation(); rejectRequest(activeTable.id, r.rid); }} aria-label={t('tableDetail.rejectAria', { name: r.name })}>
                          <UserX size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Nikoqiri */}
              <div className="host-box" onClick={() => setProfileView(hostProf(activeTable))} role="button" title={t('tableDetail.viewProfile')}>
                <Avatar
                  name={activeTable.host}
                  photo={
                    activeTable.host_id === authUser?.id
                      ? user.photo
                      : (memberPhotos[activeTable.host_id] || null)
                  }
                />
                <div className="host-info">
                  <strong>
                    {activeTable.host}{activeTable.hostAge ? `, ${activeTable.hostAge}` : ""}
                    {activeTable.hostVerified && <BadgeCheck size={15} className="verified" />}
                  </strong>
                  <span className="muted small">{activeTable.hostFrom} · {t('tableDetail.hostTablesHosted', { count: activeTable.hostTables })}</span>
                </div>
                <Stars rating={activeTable.hostRating} />
                {st !== "host" && activeTable.host_id && (
                  <div className="host-actions">
                    <button
                      className="icon-btn flag"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReportFor({ id: activeTable.host_id, name: activeTable.host });
                        setReportBlock(false);
                      }}
                      title={t('tableDetail.report')}
                      aria-label={t('tableDetail.report')}
                    >
                      <Flag size={14} />
                    </button>
                    {!blocked.includes(activeTable.host_id) && (
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void blockUser(activeTable.host_id, activeTable.host);
                        }}
                      >
                        {t('tableDetail.block')}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {profile.done && st !== "host" && (() => {
                const m = matchScore(activeTable, profile, aff);
                return (
                  <div className="why-box">
                    <div className="why-score">
                      <strong>{m}%</strong>
                      <span>{t('tableDetail.matchLabel')}</span>
                    </div>
                    <div className="why-txt">
                      <p className="why-title">{t('tableDetail.whyRecommend')}</p>
                      <p>{buildExplainMatch(t, activeTable, profile, aff)}</p>
                    </div>
                  </div>
                );
              })()}

              <p className="sheet-desc">{localizeTableDescription(activeTable.desc, t)}</p>

              {(activeTable.tags || []).length > 0 && (
                <div className="tags">{activeTable.tags.map((tg) => <span key={tg} className="tag">{tagLabel(tg)}</span>)}</div>
              )}

              <div className="people">
                <p className="label">{t('tableDetail.whoIsHere', { current: activeTable.joined.length, total: activeTable.spots })}</p>
                <div className="people-row">
                  {(activeTable.members?.length
                    ? activeTable.members
                    : activeTable.joined.map((n, i) => ({
                        user_id: activeTable.joinedIds?.[i],
                        name: n,
                        photo_path: null,
                      }))
                  ).map((m, i) => (
                    <div
                      key={`${m.user_id || m.name}-${i}`}
                      className="person"
                      onClick={() => setProfileView(
                        m.name === activeTable.host || m.user_id === activeTable.host_id
                          ? hostProf(activeTable)
                          : liteProf(m.name, m.user_id),
                      )}
                      role="button"
                    >
                      <Avatar
                        name={m.name}
                        photo={
                          m.user_id === authUser?.id || m.name === user.name
                            ? user.photo
                            : (memberPhotos[m.user_id] || null)
                        }
                      />
                      <span>
                        {m.user_id === authUser?.id || m.name === user.name
                          ? t('tableDetail.you')
                          : m.name.split(" ")[0]}
                        {(m.name === activeTable.host || m.user_id === activeTable.host_id) && (
                          <em> · {t('tableDetail.hostRole')}</em>
                        )}
                      </span>
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, activeTable.spots - activeTable.joined.length) }).map((_, i) => (
                    <div key={i} className="person free"><div className="avatar dashed">?</div><span>{t('tableDetail.seatFree')}</span></div>
                  ))}
                </div>
              </div>

              {/* ── Butoni sipas statusit ── */}
              {st === "none" && !tableExpired && (
                <>
                  <button className="btn full primary" onClick={() => requestJoin(activeTable.id)}>
                    {t('tableDetail.requestToJoin')}
                  </button>
                  <p className="fee-note"><ShieldCheck size={11} />{isRide(activeTable) ? t('tableDetail.paymentNoteRide', { host: activeTable.host }) : t('tableDetail.paymentNoteTable', { host: activeTable.host, fee: tableFee(activeTable).toFixed(2) })}</p>
                </>
              )}
              {st === "pending" && (
                <>
                  <button className="btn full ghost" disabled>
                    <Hourglass size={15} /> {t('tableDetail.pendingStatus', { host: activeTable.host })}
                  </button>
                  <button className="link-btn" onClick={() => cancelRequest(activeTable.id)}>{t('tableDetail.cancelRequest')}</button>
                </>
              )}
              {st === "approved" && (
                <>
                  {isRide(activeTable) ? (
                    <button className="btn full primary glow" onClick={() => confirmFreeSeat(activeTable.id)}>
                      {t('tableDetail.approvedConfirmFree')}
                    </button>
                  ) : (
                    <button className="btn full primary glow" onClick={() => startPayment(activeTable.id)}>
                      {t('tableDetail.approvedConfirmPay', { fee: tableFee(activeTable).toFixed(2) })}
                    </button>
                  )}
                  <p className="fee-note"><Lock size={11} /> {t('tableDetail.paymentFinalNote')}</p>
                </>
              )}
              {st === "joined" && (
                <>
                  <button className="btn full safety" onClick={() => sharePlan(activeTable)}>
                    <Share2 size={15} /> {t('tableDetail.sharePlan')}
                  </button>
                  <button className="btn full ghost" onClick={() => leaveTable(activeTable.id)}>
                    {isRide(activeTable) ? t('tableDetail.leaveRide') : t('tableDetail.leaveTable')}
                  </button>
                </>
              )}
              {st === "none" && tableExpired && st !== "host" && (
                <p className="fee-note muted">{t('tableDetail.expiredNoRequests')}</p>
              )}

              {st === "full" && !tableExpired && (
                <>
                  <button className="btn full primary" onClick={() => joinWaitlist(activeTable.id)}>
                    <BellRing size={16} /> {t('tableDetail.joinWaitlist')}
                  </button>
                  <p className="fee-note">{t('tableDetail.waitlistNote')}</p>
                </>
              )}
              {st === "waitlist" && (
                <>
                  <button className="btn full ghost" disabled><Hourglass size={15} /> {t('tableDetail.waitlistStatus')}</button>
                  <button className="link-btn" onClick={() => leaveWaitlist(activeTable.id)}>{t('tableDetail.leaveWaitlist')}</button>
                </>
              )}
              {st === "host" && (
                <button
                  className="btn-delete-table"
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(t('tableDetail.closeTableConfirm'))) return;
                    try {
                      const members = activeTable?.members || [];
                      for (const m of members) {
                        if (m.user_id !== authUser?.id) {
                          await sb.from('notifications').insert({
                            user_id: m.user_id,
                            icon: 'info',
                            kind: 'tableClosedByHostNotif',
                            params: { table: activeTable?.cafe || activeTable?.title || '' },
                            body: t('notifications.tableClosedByHostNotif', {
                              table: activeTable?.cafe || activeTable?.title || '',
                            }),
                          });
                        }
                      }
                      await sb.from('tables')
                        .update({ status: 'cancelled' })
                        .eq('id', active).eq('host_id', authUser?.id);

                      showToast(t('tableDetail.toastTableClosed'));
                      setActive(null);
                      refetchTables();
                    } catch (err) {
                      showToast(t('tableDetail.toastTableCloseFailed'));
                    }
                  }}
                >
                  {t('tableDetail.closeTable')}
                </button>
              )}
              {st === "host" && <button className="btn full ghost" disabled>{t('tableDetail.hostYouAreHost')}</button>}

              {/* Chat */}
              <div className="chat">
                <div className="chat-top">
                  <p className="label">{t('chat.title')}</p>
                  {(st === "joined" || st === "host") && (
                    <span className="lang-hint"><Languages size={13} /> {t('chat.autoTranslate')}</span>
                  )}
                </div>
                {(st === "joined" || st === "host") ? (
                  <>
                    <div className="chat-msgs">
                      {chatLoading && (
                        <p className="muted small center">{t('chat.loading')}</p>
                      )}
                      {!chatLoading && displayMessages.length === 0 && (
                        <p className="muted small center">{t('chat.empty')}</p>
                      )}
                      {displayMessages.map((m, i) => {
                        const tKey = (active || '') + '-' + i;
                        const tr = translations[tKey];
                        return (
                          <div key={m.id || i} className={`bubble ${m.mine ? 'mine' : ''}`}>
                            {!m.mine && <strong>{m.from}</strong>}
                            <span>{m.text}</span>
                            {tr && tr !== '...' && (
                              <span className="trans-out">
                                {tr}
                              </span>
                            )}
                            {tr === '...' && (
                              <span className="trans-out loading">{t('chat.translating')}</span>
                            )}
                            <span className="bubble-foot">
                              {!m.mine && !tr && (
                                <button
                                  className="trans-btn"
                                  onClick={() => translateMsg(active, i, m.text)}
                                >
                                  {t('chat.translateBtn')}
                                </button>
                              )}
                              <em>{m.time}</em>
                            </span>
                          </div>
                        );
                      })}
                      <div ref={chatEndRef} />
                    </div>
                    <div className="chat-input">
                      <button className="icon-btn dice" onClick={throwIcebreaker} title={t('chat.icebreakerTitle')} aria-label={t('chat.icebreakerAria')}>
                        <Dice5 size={17} />
                      </button>
                      <input placeholder={t('chat.inputPlaceholder')} value={msg}
                        onChange={(e) => setMsg(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendMsg()} />
                      <button
                        className={`icon-btn trans ${draftTranslating ? 'busy' : ''}`}
                        onClick={translateDraft}
                        disabled={!msg.trim() || draftTranslating}
                        title={t('chat.translateOwnTitle')}
                        aria-label={t('chat.translateAriaLabel')}
                      >
                        {draftTranslating ? '...' : 'GL'}
                      </button>
                      <button className="icon-btn send" onClick={() => sendMsg()} aria-label={t('chat.sendAria')}><Send size={16} /></button>
                    </div>
                  </>
                ) : (
                  <p className="muted small">{t('chat.lockedMessage')}</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ FLETA E PAGESËS ══════════ */}
      {payFor && payTable && (
        <div className="sheet-wrap" onClick={() => payState !== "processing" && closePayment(false)}>
          <div className="sheet pay" onClick={(e) => e.stopPropagation()}>
            {payState === "success" ? (
              <div className="pay-success">
                <div className="success-ring"><PartyPopper size={34} /></div>
                <h2>{t('payment.successTitle')}</h2>
                <p className="muted">{t('payment.successMeetAt', { venue: payTable.cafe, time: payTable.time.toLowerCase() })}</p>
                <div className="ticket big">
                  <div className="ticket-left">
                    <Ticket size={26} />
                    <div><strong>{t('payment.ticketLabel')}</strong><span className="ticket-code">{tickets[payFor]}</span></div>
                  </div>
                  <span className="ticket-note">{t('payment.ticketNote')}</span>
                </div>
                <button className="btn primary full" onClick={() => closePayment(true)}>{t('payment.goToTable')}</button>
              </div>
            ) : (
              <>
                <div className="sheet-hdr">
                  <button className="icon-btn" onClick={() => closePayment(false)} disabled={payState === "processing"} aria-label={t('payment.close')}><X size={18} /></button>
                  <div><h2>{t('payment.title')}</h2><p className="meta">{payTable.cafe} · {payTable.time}</p></div>
                  <SeatRing total={payTable.spots} taken={payTable.joined.length} size={44} />
                </div>

                <div className="pay-summary">
                  <div className="pay-row"><span>{isRide(payTable) ? t('payment.rideSeatApproved') : t('payment.tableSeatApproved')}</span><span>{tableFee(payTable).toFixed(2)} €</span></div>
                  <div className="pay-row muted small"><span>{isRide(payTable) ? t('payment.rideExtrasNote') : t('payment.tableExtrasNote')}</span><span>-</span></div>
                  <div className="pay-row total"><span>{t('payment.totalNow')}</span><span>{tableFee(payTable).toFixed(2)} €</span></div>
                </div>

                <p className="label">{t('payment.paymentMethodLabel')}</p>
                <div className="pay-methods">
                  <button className={`method ${payMethod === "card" ? "on" : ""}`} onClick={() => setPayMethod("card")}>
                    <CreditCard size={18} /> {t('payment.cardMethod')}
                  </button>
                  <button className={`method ${payMethod === "paypal" ? "on" : ""}`} onClick={() => setPayMethod("paypal")}>
                    <Wallet size={18} /> {t('payment.paypalMethod')}
                  </button>
                </div>

                {payMethod === "card" && (
                  <div className="card-form">
                    <input className="input" placeholder={t('payment.cardNumberLabel')} inputMode="numeric"
                      value={card.num} onChange={(e) => setCard({ ...card, num: formatCardNum(e.target.value) })} />
                    <div className="card-grid">
                      <input className="input" placeholder={t('payment.expiryLabel')} inputMode="numeric"
                        value={card.exp} onChange={(e) => setCard({ ...card, exp: formatExpiry(e.target.value) })} />
                      <input className="input" placeholder={t('payment.cvvLabel')} inputMode="numeric" maxLength={3}
                        value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "") })} />
                    </div>
                    <input className="input" placeholder={t('payment.nameOnCardLabel')}
                      value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} />
                  </div>
                )}
                {payMethod === "paypal" && (
                  <p className="muted small paypal-note">{t('payment.paypalNote')}</p>
                )}

                <button className="btn primary full"
                  disabled={payState === "processing" || (payMethod === "card" && !validCard(card))}
                  onClick={confirmPayment}>
                  {payState === "processing"
                    ? <span className="spinner" aria-label={t('payment.processing')} />
                    : t('payment.payButton', { amount: tableFee(payTable).toFixed(2) })}
                </button>
                <p className="fee-note"><Lock size={11} /> {t('payment.secureNote')}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════ KRIJO TAVOLINË ══════════ */}
      {showCreate && (
        <div className="sheet-wrap" onClick={() => setShowCreate(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-hdr">
              <button className="icon-btn" onClick={() => setShowCreate(false)} aria-label={t('createTable.close')}><X size={18} /></button>
              <div><h2>{form.mode === "sport" ? t('sports.title') : form.mode === "vozitje" ? t('createTable.titleVozitje') : form.mode === "udhetim" ? t('createTable.titleUdhetim') : t('createTable.titleTavoline')}</h2><p className="meta">{form.mode === "sport" ? t('sports.meta') : form.mode === "vozitje" ? t('createTable.metaVozitje') : form.mode === "udhetim" ? t('createTable.metaUdhetim') : t('createTable.metaTavoline')}</p></div>
              <SeatRing total={Number(form.spots) || 4} taken={1} size={48} />
            </div>

            <div className="mode-toggle">
              <button className={`mode-btn ${form.mode === "tavoline" ? "on" : ""}`}
                onClick={() => setForm({ ...form, mode: "tavoline", spots: 4 })}>{t('createTable.modeTavoline')}</button>
              <button className={`mode-btn ${form.mode === "sport" ? "on" : ""}`}
                onClick={() => setForm({ ...form, mode: "sport", spots: 10, sport: form.sport || (sportFilter !== "all" ? sportFilter : "") })}>{t('sports.mode')}</button>
              <button className={`mode-btn ${form.mode === "vozitje" ? "on" : ""}`}
                onClick={() => setForm({ ...form, mode: "vozitje", spots: 3 })}>{t('createTable.modeVozitje')}</button>
              <button className={`mode-btn ${form.mode === "udhetim" ? "on" : ""}`}
                onClick={() => setForm({ ...form, mode: "udhetim", spots: 5 })}>{t('createTable.modeUdhetim')}</button>
            </div>

            <label className="f-label" htmlFor="f-city">{form.mode === "vozitje" ? t('createTable.labelCityFrom') : form.mode === "udhetim" ? t('createTable.labelCityStart') : t('createTable.labelCityTavoline')}</label>
            <select id="f-city" className="input select" value={basicLocked && homeCity ? homeCity : form.city}
              disabled={basicLocked}
              onChange={(e) => setForm({ ...form, city: e.target.value })}>
              {(basicLocked && homeCity ? [homeCity] : CITIES).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {basicLocked && plan?.table_limit != null && (
              <div className={`usage-meter ${limitReached ? 'full' : ''}`}>
                <span>{t('plans.usage', { used: plan.tables_this_month, limit: plan.table_limit })}</span>
                <span className="bar"><span style={{ width: `${Math.min(100, (plan.tables_this_month / Math.max(1, plan.table_limit)) * 100)}%` }} /></span>
              </div>
            )}

            {form.mode === "vozitje" && (
              <>
                <label className="f-label" htmlFor="f-tocity">{t('createTable.labelCityTo')}</label>
                <select id="f-tocity" className="input select" value={form.toCity}
                  onChange={(e) => setForm({ ...form, toCity: e.target.value })}>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label className="f-label" htmlFor="f-pickup">{t('createTable.labelPickup')}</label>
                <input id="f-pickup" className="input" placeholder={t('createTable.pickupPlaceholder')} value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })} />
                <p className="free-note">{t('createTable.rideFreeNote')}</p>
              </>
            )}
            {form.mode === "udhetim" && (
              <>
                <label className="f-label" htmlFor="f-dest">{t('createTable.labelDestination')}</label>
                <input id="f-dest" className="input" placeholder={t('createTable.destinationPlaceholder')} value={form.cafe}
                  onChange={(e) => setForm({ ...form, cafe: e.target.value })} />
                <label className="f-label" htmlFor="f-budget">{t('createTable.labelBudget')}</label>
                <input id="f-budget" className="input" placeholder={t('createTable.budgetPlaceholder')} value={form.budget || ""}
                  onChange={(e) => setForm({ ...form, budget: e.target.value })} />
              </>
            )}
            {(form.mode === "tavoline" || form.mode === "sport") && (
              <>
                <label className="f-label" htmlFor="f-cafe">{form.mode === "sport" ? t('sports.venue') : t('createTable.labelVenue')}</label>
                <input id="f-cafe" className="input" placeholder={form.mode === "sport" ? t('sports.venuePh') : t('createTable.venuePlaceholder')} value={form.cafe}
                  onChange={(e) => setForm({ ...form, cafe: e.target.value })} />
                <label className="f-label" htmlFor="f-area">{t('createTable.labelArea')}</label>
                <input id="f-area" className="input" placeholder={t('createTable.areaPlaceholder')} value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })} />
              </>
            )}

            <label className="f-label" htmlFor="f-maps">{t('createTable.mapsLinkLabel')}</label>
            <input
              id="f-maps"
              className="input"
              placeholder={t('createTable.mapsLinkPlaceholder')}
              value={form.mapsLink}
              onChange={(e) => setForm({ ...form, mapsLink: e.target.value })}
              required
            />
            <p className="input-hint">{t('createTable.mapsLinkHelper')}</p>

            <label className="f-label" htmlFor="f-event-date">{form.mode === "vozitje" ? t('createTable.labelWhenRide') : t('createTable.labelWhen')}</label>
            <div className="datetime-row">
              <input
                id="f-event-date"
                className="input"
                type="date"
                value={form.eventDate || ""}
                min={localDateInputValue()}
                onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
              />
              <input
                id="f-event-time"
                className="input"
                type="time"
                value={form.eventTime || ""}
                onChange={(e) => setForm({ ...form, eventTime: e.target.value })}
              />
            </div>

            {form.mode === "sport" && (<>
            <label className="f-label">{t('sports.pickSport')}</label>
            <div className="cat-row wrap sport-pick" role="radiogroup">
              {SPORTS.map((sp) => (
                <button key={sp} type="button" role="radio" aria-checked={form.sport === sp}
                  className={`chip ${form.sport === sp ? "on" : ""}`}
                  onClick={() => setForm({ ...form, sport: sp })}>
                  {t(`sports.list.${sp}`)}
                </button>
              ))}
            </div>
            <label className="f-label">{t('sports.level')}</label>
            <div className="cat-row wrap">
              {SKILL_LEVELS.map((lv) => (
                <button key={lv} type="button" className={`chip ${form.level === lv ? "on" : ""}`}
                  onClick={() => setForm({ ...form, level: lv })}>
                  {t(`sports.levels.${lv}`)}
                </button>
              ))}
            </div>
            </>)}

            {form.mode === "tavoline" && (<>
            <label className="f-label">{t('createTable.labelType')}</label>
            <div className="cat-row wrap">
              {CATEGORIES.filter((c) => c.id !== "vozitje" && c.id !== "sport").map((c) => (
                  <button key={c.id} className={`chip ${form.cat === c.id ? "on" : ""}`}
                    onClick={() => setForm({ ...form, cat: c.id })}>
                    {catLabel(c.id)}
                  </button>
              ))}
            </div>

            </>)}

            <label className="f-label">{form.mode === "sport" ? t('sports.players', { count: form.spots }) : form.mode === "vozitje" ? t('createTable.labelSeatsRide', { count: form.spots }) : form.mode === "udhetim" ? t('createTable.labelSeatsTrip', { count: form.spots }) : t('createTable.labelSeatsTable', { count: form.spots })}</label>
            <input type="range" min={form.mode === "vozitje" ? 1 : 2} max={form.mode === "vozitje" ? 4 : form.mode === "sport" ? 22 : 10} value={form.spots} className="range"
              onChange={(e) => setForm({ ...form, spots: e.target.value })} />

            <label className="f-label">{t('createTable.labelLangs')}</label>
            <div className="lang-grid">
              {LANGUAGES.map((l) => (
                <button
                  key={l.v}
                  type="button"
                  className={`lang-chip ${form.langs?.includes(l.v) ? "on" : ""}`}
                  onClick={() => setForm((f) => ({
                    ...f,
                    langs: f.langs?.includes(l.v)
                      ? f.langs.filter((x) => x !== l.v)
                      : [...(f.langs || []), l.v],
                  }))}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {(form.mode === "tavoline" || form.mode === "sport") && (
            <div className="gender-restriction-options">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={form.womenOnly}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    womenOnly: e.target.checked,
                    menOnly: e.target.checked ? false : f.menOnly,
                  }))}
                />
                <span>{t('createTable.genderWomenOnly')}</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={form.menOnly}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    menOnly: e.target.checked,
                    womenOnly: e.target.checked ? false : f.womenOnly,
                  }))}
                />
                <span>{t('createTable.genderMenOnly')}</span>
              </label>
            </div>
            )}

            <label className="f-label" htmlFor="f-desc">{t('createTable.labelDescription')}</label>
            <textarea id="f-desc" className="input" rows={3} placeholder={t('createTable.descriptionPlaceholder')}
              value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />

            {limitReached ? (
              <div className="upsell">
                <strong>{t('plans.limitReachedTitle', { limit: plan.table_limit })}</strong>
                <span>{t('plans.limitReachedSub')}</span>
                <button type="button" className="btn primary" onClick={() => setShowPlans(true)}>{t('plans.seePremium')}</button>
              </div>
            ) : (<button className="btn primary full" onClick={createTable}>{form.mode === "sport" ? t('sports.submit') : form.mode === "vozitje" ? t('createTable.submitRide') : form.mode === "udhetim" ? t('createTable.submitTrip') : t('createTable.submitTable')}</button>)}
            <p className="fee-note"><ShieldCheck size={11} /> {form.mode === "vozitje" ? t('createTable.feeNoteRide') : t('createTable.feeNoteTable', { fee: BOOKING_FEE.toFixed(2) })}</p>
          </div>
        </div>
      )}

      {/* ══════════ DARKA E SË MËRKURËS. KUIZI ══════════ */}
      {showWed && (
        <div className="sheet-wrap" onClick={() => matchState !== "matching" && setShowWed(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            {matchState === "quiz" && (
              <>
                <div className="sheet-hdr">
                  <button className="icon-btn" onClick={() => setShowWed(false)} aria-label={t('payment.close')}><X size={18} /></button>
                  <div><h2>{t('wednesdayQuiz.title')}</h2><p className="meta">{t('wednesdayQuiz.progress', { current: quizStep + 1, total: QUIZ.length })}</p></div>
                </div>
                <div className="quiz-bar"><div className="quiz-fill" style={{ width: `${(quizStep / QUIZ.length) * 100}%` }} /></div>
                <p className="quiz-q">{t(`wednesdayQuiz.questions.${QUIZ[quizStep].key}.question`)}</p>
                {QUIZ[quizStep].type === "langs" ? (
                  <>
                    <div className="lang-grid">
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.v}
                          type="button"
                          className={`lang-chip ${wedLangSel.includes(l.v) ? "on" : ""}`}
                          onClick={() => setWedLangSel((prev) => (
                            prev.includes(l.v)
                              ? prev.filter((x) => x !== l.v)
                              : [...prev, l.v]
                          ))}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                    <button
                      className="btn primary full"
                      disabled={!wedLangSel.length}
                      onClick={completeWedLangQuestion}
                    >
                      {wedLangSel.length
                        ? t('wednesdayQuiz.continueWithCount', { count: wedLangSel.length })
                        : t('wednesdayQuiz.continueBtn')}
                    </button>
                    <p className="step-hint">{t('wednesdayQuiz.langsHint')}</p>
                  </>
                ) : (
                  <>
                    <div className="ob-choice">
                      {QUIZ[quizStep].options.map(({ v }) => (
                        <button
                          key={v}
                          type="button"
                          className={`choice ${v === 'other' && wedShowOtherInput ? 'on' : ''}`}
                          onClick={() => answerWedQuiz(v)}
                        >
                          {t(`wednesdayQuiz.questions.${QUIZ[quizStep].key}.options.${v}`)}
                        </button>
                      ))}
                    </div>
                    {wedShowOtherInput && (
                      <div className="wed-other-block">
                        <input
                          type="text"
                          className="input modern"
                          placeholder={t('wednesdayQuiz.otherPlaceholder')}
                          value={wedOtherText}
                          onChange={(e) => setWedOtherText(e.target.value)}
                          maxLength={60}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn primary full"
                          onClick={submitWedOtherAnswer}
                        >
                          {t('wednesdayQuiz.continueBtn')}
                        </button>
                      </div>
                    )}
                  </>
                )}
                <p className="fee-note"><Sparkles size={11} /> {t('wednesdayQuiz.feeNote')}</p>
              </>
            )}
            {matchState === "matching" && (
              <div className="pay-success">
                <div className="success-ring spin-ring"><Sparkles size={30} /></div>
                <h2>{t('wednesdayQuiz.matchingTitle')}</h2>
                <p className="muted">{t('wednesdayQuiz.matchingSub')}</p>
              </div>
            )}
            {matchState === "signed" && (() => {
              const sg = wedStatus?.signup;
              if (!sg) return null;
              const when = new Date(sg.dinner_date).toLocaleString(locale === 'sq' ? 'sq-AL' : locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
              const deadline = new Date(sg.deadline).toLocaleString(locale === 'sq' ? 'sq-AL' : locale, { weekday: 'long', hour: '2-digit', minute: '2-digit' });
              return (
                <div className="pay-success wed-signed">
                  <div className="success-ring"><PartyPopper size={34} /></div>
                  {sg.status === 'signed_up' && (<>
                    <h2>{t('plans.wedSignedTitle')}</h2>
                    <p className="muted">{t('plans.wedSignedSub', { when, city: sg.city, deadline })}</p>
                    <p className="muted small">{wedStatus?.premium ? t('plans.wedPremiumFirst') : t('plans.wedBasicNote')}</p>
                    {!wedStatus?.premium && <button type="button" className="btn ghost" onClick={() => { setShowWed(false); setShowPlans(true); }}>{t('plans.seePremium')}</button>}
                    <button type="button" className="btn ghost full" onClick={cancelWedSignup}>{t('plans.wedCancel')}</button>
                  </>)}
                  {sg.status === 'grouped' && (<>
                    <h2>{t('wednesdayQuiz.matchedTitle')}</h2>
                    <p className="muted">{t('plans.wedGroupedSub', { count: Math.max(0, (sg.members || []).length - 1), when })}</p>
                    <div className="match-row person-grid">
                      {(sg.members || []).map((p) => (
                        <div key={p.user_id} className="person"><Avatar name={p.first_name} /><span>{p.first_name}{p.age ? `, ${p.age}` : ''}</span></div>
                      ))}
                    </div>
                    <div className="lock-card slim-lock">
                      <Lock size={16} />
                      <div><strong>{when}</strong><span>{t('wednesdayQuiz.matchedVenueHint')}</span></div>
                    </div>
                    {sg.table_id && <button className="btn primary full" onClick={openWedTable}>{t('wednesdayQuiz.goToMyTable')}</button>}
                  </>)}
                  {sg.status === 'waitlisted' && (<>
                    <h2>{t('plans.wedWaitlistedTitle')}</h2>
                    <p className="muted">{t('plans.wedWaitlistedSub')}</p>
                  </>)}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ══════════ VLERËSIMI PAS TAKIMIT ══════════ */}
      {rateFor && (
        <div className="sheet-wrap" onClick={() => setRateFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-hdr">
              <button className="icon-btn" onClick={() => setRateFor(null)} aria-label={t('payment.close')}><X size={18} /></button>
              <div><h2>Si ishte përvoja?</h2><p className="meta">{tables.find((t) => t.id === rateFor)?.cafe}</p></div>
            </div>
            <div className="rate-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={`star-btn ${n <= rateStars ? "on" : ""}`} onClick={() => setRateStars(n)} aria-label={`${n} yje`}>
                  <span style={{ fontSize: 32, lineHeight: 1, color: n <= rateStars ? "#FF6B35" : "#C4B694" }}>{n <= rateStars ? "★" : "☆"}</span>
                </button>
              ))}
            </div>
            <p className="label center-label">A do të takoheshe sërish me këtë grup?</p>
            <div className="pay-methods">
              <button className={`method ${rateAgain === true ? "on" : ""}`} onClick={() => setRateAgain(true)}>Po, patjetër</button>
              <button className={`method ${rateAgain === false ? "on" : ""}`} onClick={() => setRateAgain(false)}>Ndoshta jo</button>
            </div>
            <p className="label center-label">Me kë do të mbaje kontakt? (opsionale)</p>
            <p className="muted small center" style={{ marginBottom: 8 }}>Ata nuk e marrin vesh nëse nuk të zgjedhin edhe ty. Vetëm përputhjet e ndërsjella hapin chat privat.</p>
            <div className="connect-row">
              {(() => {
                const rT = tables.find((t) => t.id === rateFor);
                const members = (rT?.joined || [])
                  .map((n, i) => ({ name: n, id: rT.joinedIds?.[i] }))
                  .filter((m) => m.id && m.id !== authUser?.id && m.name !== user.name);
                return members.map((m) => (
                  <button
                    key={m.id}
                    className={`conn-pick ${rateSelect.includes(m.id) ? "on" : ""}`}
                    onClick={() => setRateSelect((p) => (
                      p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]
                    ))}
                  >
                    <Avatar name={m.name} small /> {m.name.split(" ")[0]}
                    {rateSelect.includes(m.id) && <Check size={13} />}
                  </button>
                ));
              })()}
            </div>
            <button className="btn primary full" disabled={rateStars === 0 || rateAgain === null} onClick={submitRating}>
              Dërgo vlerësimin
            </button>
            <p className="fee-note"><Sparkles size={11} /> Vlerësimet përdoren për përputhje më të mira dhe për yjet e nikoqirëve</p>
          </div>
        </div>
      )}

      {/* ══════════ PROFILI. Dritarja e detyrueshme ══════════ */}
      {profileView && (
        <div className="sheet-wrap centerv" onClick={() => setProfileView(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn modal-x" onClick={() => setProfileView(null)} aria-label={t('profile.close')}><X size={15} /></button>
            {profileView.photo
              ? <img src={profileView.photo} alt={profileView.name} className="prof-photo" />
              : <div className="prof-photo initial">{profileView.name?.[0]?.toUpperCase()}</div>}
            <h2 className="prof-name">
              {profileView.name}{profileView.age ? `, ${profileView.age}` : ""}
              {profileView.verified && <BadgeCheck size={16} className="verified" />}
            </h2>
            {profileView.from && <p className="prof-from">{profileView.from}</p>}
            {profileView.isHost && (
              <div className="prof-stats">
                <span>★ {Number(profileView.rating).toFixed(1)}</span>
                <span>·</span>
                <span>{t('profile.tablesHeld', { count: profileView.tablesHeld })}</span>
              </div>
            )}
            {profileView.langs && <p className="prof-langs"><Globe size={12} /> {formatLangs(profileView.langs)}</p>}
            <p className="prof-note"><ShieldCheck size={13} /> {t('profile.faceVerificationNotice')}</p>
            {profileView.name !== user.name && profileView.id && !profileView.isMe && (
              <div className="prof-actions">
                <button
                  className="btn ghost full"
                  onClick={() => {
                    setReportFor({ id: profileView.id, name: profileView.name });
                    setReportBlock(false);
                    setProfileView(null);
                  }}
                >
                  <Flag size={13} /> {t('profile.reportUser')}
                </button>
                {!blocked.includes(profileView.id) && (
                  <button
                    className="btn ghost full"
                    type="button"
                    onClick={() => {
                      void blockUser(profileView.id, profileView.name);
                    }}
                  >
                    {t('profile.blockUser')}
                  </button>
                )}
              </div>
            )}
            {profileView?.isMe && (
              <>
                <button
                  className="btn ghost full"
                  type="button"
                  onClick={() => {
                    setProfileView(null);
                    setScreen("change-password");
                  }}
                >
                  {t('profile.changePassword')}
                </button>
                <button
                  className="btn ghost full"
                  type="button"
                  onClick={() => {
                    setProfileView(null);
                    setScreen("blocked-users");
                  }}
                >
                  {t('profile.blockedUsers')}
                </button>
                <button
                  className="btn ghost full"
                  type="button"
                  onClick={() => {
                    setProfileView(null);
                    setScreen("my-reports");
                  }}
                >
                  {t('profile.myReports')}
                </button>
                <button
                  className="btn ghost full"
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('profile.confirmSignOut'))) void handleSignOut();
                    setProfileView(null);
                  }}
                >
                  {t('profile.signOut')}
                </button>
                <button className="btn-deactivate" type="button" onClick={deactivateAccount}>
                  {t('profile.deactivateAccount')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════ RAPORTO / BLLOKO ══════════ */}
      {reportFor && (
        <div className="sheet-wrap" onClick={() => setReportFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-hdr">
              <button className="icon-btn" onClick={() => setReportFor(null)} aria-label={t('profile.close')}><X size={18} /></button>
              <div><h2>{t('reportBlockSheet.reportTitle')}</h2><p className="meta">{reportFor.name}</p></div>
            </div>
            <p className="label">{t('reportBlockSheet.reasonLabel')}</p>
            <div className="ob-choice">
              {REPORT_REASON_CODES.map((code) => (
                <button key={code} className={`choice ${reportReason === code ? "on" : ""}`} onClick={() => setReportReason(code)}>{t(`reportBlockSheet.reasons.${code}`)}</button>
              ))}
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={reportBlock} onChange={(e) => setReportBlock(e.target.checked)} />
              <span>{t('reportBlockSheet.blockAlsoCheckbox', { name: reportFor.name.split(" ")[0] })}</span>
            </label>
            <button className="btn primary full" disabled={!reportReason || !reportFor.id} onClick={submitReport}>{t('reportBlockSheet.submitReport')}</button>
            {!blocked.includes(reportFor.id) && (
              <button
                className="btn ghost full"
                type="button"
                onClick={() => void blockUser(reportFor.id, reportFor.name).then((ok) => { if (ok) setReportFor(null); })}
              >
                {t('reportBlockSheet.blockWithoutReport')}
              </button>
            )}
            <p className="fee-note">{t('reportBlockSheet.anonymityNote', { name: reportFor.name.split(" ")[0] })}</p>
          </div>
        </div>
      )}

      {blockPromptFor && (
        <div className="sheet-wrap" onClick={() => setBlockPromptFor(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-hdr">
              <button className="icon-btn" onClick={() => setBlockPromptFor(null)} aria-label={t('profile.close')}><X size={18} /></button>
              <div><h2>{t('reportBlockSheet.reportSentTitle')}</h2><p className="meta">{blockPromptFor.name}</p></div>
            </div>
            <p>{t('reportBlockSheet.postReportPrompt', { name: blockPromptFor.name.split(" ")[0] })}</p>
            <button
              className="btn primary full"
              type="button"
              onClick={() => void blockUser(blockPromptFor.id, blockPromptFor.name, { confirm: false })}
            >
              {t('reportBlockSheet.blockUserBtn')}
            </button>
            <button className="btn ghost full" type="button" onClick={() => setBlockPromptFor(null)}>
              {t('reportBlockSheet.postReportNoThanks')}
            </button>
          </div>
        </div>
      )}

      {/* ══════════ AI MATCH. KUIZI I PROFILIT ══════════ */}
      {showMQ && (() => {
        const Q = MATCH_QUIZ[mqi];
        const currentValue = quizAnswers[Q.key];
        const multiSel = Q.type === "multi" ? (currentValue || []) : currentValue;
        const tasteOptionLabel = (v) => t(`tasteQuiz.questions.${Q.key}.options.${v}`);
        return (
          <div className="sheet-wrap" onClick={() => setShowMQ(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-hdr">
                <button className="icon-btn" onClick={() => mqi > 0 ? setMqi(mqi - 1) : setShowMQ(false)} aria-label={t('onboarding.back')}><ChevronLeft size={18} /></button>
                <div><h2>{t('tasteQuiz.title')}</h2><p className="meta">{t('tasteQuiz.progress', { current: mqi + 1, total: MATCH_QUIZ.length })}</p></div>
              </div>
              <div className="quiz-progress">
                {MATCH_QUIZ.map((q, i) => (
                  <button
                    key={q.key}
                    type="button"
                    className={`quiz-dot ${i === mqi ? "current" : ""} ${quizAnswerFilled(q, quizAnswers[q.key]) ? "answered" : ""}`}
                    onClick={() => setMqi(i)}
                    aria-label={t('tasteQuiz.progress', { current: i + 1, total: MATCH_QUIZ.length })}
                  />
                ))}
              </div>
              <p className="quiz-q">{t(`tasteQuiz.questions.${Q.key}.question`)}</p>
              <div className="ob-choice">
                {Q.options.map(({ v }) => (
                  <button key={v}
                    className={`choice ${Q.type === "multi"
                      ? (multiSel.includes(v) ? "on" : "")
                      : (currentValue === v ? "on" : "")}`}
                    onClick={() => handleQuizAnswer(v)}>
                    {tasteOptionLabel(v)}{Q.type === "multi" && multiSel.includes(v) && "  ✓"}
                  </button>
                ))}
              </div>
              {Q.type === "multi" && (
                <button
                  className="btn primary full"
                  disabled={!quizAnswerFilled(Q, quizAnswers[Q.key])}
                  onClick={() => {
                    const wasAlreadyAnswered = quizAnswerFilled(Q, quizAnswers[Q.key]);
                    if (!wasAlreadyAnswered && mqi < MATCH_QUIZ.length - 1) {
                      setTimeout(() => setMqi((i) => i + 1), 250);
                    } else if (mqi < MATCH_QUIZ.length - 1) {
                      setMqi((i) => i + 1);
                    } else {
                      void finishMQ();
                    }
                  }}
                >
                  {(quizAnswers[Q.key] || []).length === 0 && !quizAnswerFilled(Q, quizAnswers[Q.key])
                    ? t('tasteQuiz.continueBtn')
                    : mqi < MATCH_QUIZ.length - 1
                      ? t('tasteQuiz.continueWithCount', { count: (quizAnswers[Q.key] || []).length, max: Q.max })
                      : t('tasteQuiz.finishBtn')}
                </button>
              )}
              {Q.type === "single" && quizAnswerFilled(Q, quizAnswers[Q.key]) && mqi < MATCH_QUIZ.length - 1 && (
                <button className="btn primary full" onClick={() => setMqi((i) => i + 1)}>{t('tasteQuiz.continueBtn')}</button>
              )}
              {Q.type === "single" && mqi === MATCH_QUIZ.length - 1 && quizAnswerFilled(Q, quizAnswers[Q.key]) && (
                <button className="btn primary full" onClick={() => void finishMQ()}>{t('tasteQuiz.finishBtn')}</button>
              )}
              <button type="button" className="quiz-skip" onClick={skipQuizQuestion}>
                {t('tasteQuiz.skipBtn')}
              </button>
              <button className="link-btn" onClick={() => setShowMQ(false)}>{t('tasteQuiz.laterBtn')}</button>
              <p className="fee-note">{t('tasteQuiz.feeNote')}</p>
            </div>
          </div>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════  STILI  ══════════════════════════ */
function Style() {
  return null;
}

export default HajdeApp;
