/// <reference types="vite/client" />

/** Build-time settings (hajde/.env, Cloudflare Pages / Vercel env). All optional. */
interface ImportMetaEnv {
  /** Django backend, e.g. https://api.ejabashkohu.com (default http://localhost:8000) */
  readonly VITE_API_URL?: string
  /** Support number for the WhatsApp button and Premium payments, digits only */
  readonly VITE_SUPPORT_WHATSAPP?: string
  /** Fallback Jitsi server when the backend does not name one (default meet.jit.si) */
  readonly VITE_JITSI_DOMAIN?: string
  /** Prefix for Jitsi room names on the fallback server */
  readonly VITE_JITSI_ROOM_PREFIX?: string
  /** Store and social links in the profile sheet (defaults in components/profile/EditProfile.tsx) */
  readonly VITE_APP_STORE_URL?: string
  readonly VITE_PLAY_STORE_URL?: string
  readonly VITE_INSTAGRAM_URL?: string
  readonly VITE_FACEBOOK_URL?: string
  readonly VITE_TIKTOK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
