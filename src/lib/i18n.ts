/**
 * SafeGround EN|ES strings (PR-B, Wave 3 trust build).
 *
 * Zero-dependency dictionary: no i18n library, pure client module.
 * NEVER imports db/pg/server code (2026-09-08 P0 lesson) — react only.
 *
 * Contract:
 * - EN is the always-present fallback: t() never returns blank. If a key is
 *   missing in ES (or the whole ES entry is absent), EN renders instead.
 * - EN keys are never removed; ES is Partial so untranslated keys fall back.
 * - The welcome/home PREFACE stays EN in v1 (needs a human translator) with
 *   a visible "Espanol proximamente" note — see components/welcome.tsx.
 * - Language persists to localStorage key `sg.lang` ('en' | 'es').
 */
import { useSyncExternalStore } from "react";

export type Lang = "en" | "es";
export const LANG_KEY = "sg.lang";

/* ── English (source of truth — every key present) ─────────────── */

const EN = {
  // Bottom nav
  nav_home: "Home",
  nav_help: "Find help",
  nav_sweeps: "Sweeps",
  nav_checkin: "Check in",
  // Fast Exit
  fast_exit: "Fast Exit",
  fast_exit_label: "Fast Exit — leave SafeGround now",
  // Menu sheet
  menu_title: "Menu",
  menu_hometeam: "HomeTeam — step in for a neighbor",
  menu_about: "About & privacy",
  menu_welcome: "Welcome — what SafeGround is",
  menu_queue: "Peer-support queue (outreach)",
  menu_notify: "Notifications test (team)",
  menu_crisis: "Crisis resources",
  menu_signin: "Sign in",
  menu_signout: "Sign out",
  menu_signed_in_as: "Signed in as",
  // Crisis sheet
  crisis_title: "Talk to someone",
  crisis_intro:
    "You're not alone tonight. These lines are free, private, and answered by people who listen.",
  crisis_call: "Call or text 988 — Suicide & Crisis Lifeline",
  crisis_chat: "Chat online at 988lifeline.org",
  crisis_outro: "No pressure and no rush — this sheet stays here for whenever you need it.",
  // Resource category chips (short) + full names (list meta lines)
  cat_food: "Food",
  cat_shelter: "Shelter",
  cat_water: "Water",
  cat_showers: "Showers",
  cat_clinics: "Clinics",
  cat_charging: "Charging",
  cat_legal: "Legal",
  cat_daycenters: "Day centers",
  cat_transportation: "Rides",
  cat_emergency: "Crisis help",
  catname_food: "Food",
  catname_shelter: "Shelter & sleep",
  catname_water: "Water",
  catname_showers: "Restrooms & showers",
  catname_clinics: "Health & clinics",
  catname_charging: "Charging & Wi-Fi",
  catname_legal: "Legal aid",
  catname_daycenters: "Day centers",
  catname_transportation: "Transportation & rides",
  catname_emergency: "Crisis response",
  // Help page chrome around the chips
  help_chips: "Categories — choose any to filter",
  help_search: "Search name or place…",
  help_list: "List",
  help_map: "Map",
  // Peer-support form
  ps_title: "Request peer support",
  ps_sub: "One tap asks an MPRCC peer to reach out. Never calls 911.",
  ps_phone: "Your phone number",
  ps_phone_help: "So a peer can reach you back. Stays on this device + the team's queue.",
  ps_phone_bad: "That number looks incomplete — please check it, no rush.",
  ps_need_phone: "A complete phone number first — no rush.",
  ps_name: "Your first name (optional)",
  ps_name_ph: "Your first name",
  ps_note: "Anything you'd like them to know? (optional)",
  ps_note_help: "Up to 500 characters — only the outreach team sees this",
  ps_note_ph: "e.g. Evenings are best, I'm near the library…",
  ps_submit: "Request peer support",
  ps_who: "Jenn + Bambi, MPRCC peer outreach — the only two people notified",
  ps_what: "Your phone, your name if you gave one, and your note",
  ps_how: "It stays in the team's queue until it's marked done",
  ps_stop: "Nothing is shared until you tap below",
  ps_ready: "Ready to send?",
  ps_ready_sub: "Nothing has gone anywhere yet — this is still yours.",
  ps_call: "They'll call",
  ps_yourname: "Your name",
  ps_yournote: "Your note",
  ps_scope: "Goes only to Jenn + Bambi on the MPRCC outreach team. Never 911, never anyone else.",
  ps_yes: "Yes — ask for a peer",
  ps_notyet: "Not yet — let me change something",
  ps_done: "An MPRCC peer will reach out. We're here.",
  ps_done_a: "The outreach team has your request and will contact you at the number you gave.",
  ps_done_b: "Your request is in the team's queue — a peer will follow up as soon as they're connected.",
  ps_done_privacy: "This stays between you and the MPRCC outreach team — never 911, never anyone else.",
  ps_home: "Back home",
  // HomeTeam page + sheets
  ht_sub: "Neighbors share what they need — supporters step in when they can.",
  ht_join: "Join the HomeTeam",
  ht_log: "Log a need",
  ht_log_for: "Log a need for someone",
  ht_what: "What's needed",
  ht_what_ph: "tent, warm socks, bus pass",
  ht_what_help: "Comma-separated is fine — e.g. tent, sleeping bag.",
  ht_else: "Anything else to know (optional)",
  ht_else_ph: "Where to bring it, what works best — keep it general.",
  ht_pickup: "Pickup preference (optional)",
  ht_pickup_ph: "e.g. meet near the library",
  ht_who: "Who may see this",
  ht_vis_open: "Anyone can help",
  ht_vis_assign: "Coordinator assigns",
  ht_vis_private: "Private",
  ht_priv_note: "Private needs stay between the neighbor and the outreach team.",
  ht_share: "Share the need",
  ht_first_win: "First claim wins — the neighbor sees who's helping and when it arrives.",
  ht_claim: "I got that",
  ht_deliver: "Mark delivered",
  ht_claimed_me: "You're on it — the neighbor can see you.",
  ht_helping_on_it: "is on it",
  ht_private_line: "Arranged privately by the team — thank you for checking.",
  ht_now: "Needs right now",
  ht_handling: "Being handled",
  ht_delivered_sec: "Delivered",
  ht_none: "No open needs right now",
  ht_none_body:
    "When a neighbor shares what they need, it will show here — calm and clear, with the first person to step up shown.",
  ht_supporting_as: "Supporting as",
  ht_your_number: "Your number:",
  ht_pause: "Pause",
  ht_outreach_line: "Outreach — you can log needs for neighbors too.",
  ht_add_phone: "To claim or share a need, add the number you'd like to be known by — it stays on this device.",
  ht_phone_req: "Required to log a need — needs are attributed to a real number.",
  ht_no_loc: "Your location is never shared, and needs disappear as soon as they're delivered.",
  ht_join_intro:
    "Neighbors share what they need, and supporters step in — only what's shared, only when they ask.",
  ht_join_phone: "Your phone",
  ht_join_phone_help: "Used only to match you as a supporter — never shown to strangers.",
  ht_join_name: "Your name",
  ht_join_name_ph: "First name is fine",
  ht_join_name_help: "How the people you help will see you.",
  ht_ah: "Also reach me after hours",
  ht_ah_sub: "Emergency alerts outside 8am–6pm Mon–Fri. Off by default.",
  ht_join_no_loc: "No location is ever shared, and there's no account or app to install.",
  ht_their_phone: "Their phone",
  ht_their_phone_ph: "10 digits, e.g. 4155550142",
  ht_their_phone_help: "Outreach logs on the neighbor's behalf — the need is attributed to them.",
  ht_their_name: "Their name",
  ht_their_name_help: "First name, the way they'd like it.",
  ht_st_open: "Open",
  ht_st_claimed: "Claimed",
  ht_st_progress: "Help on the way",
  ht_st_delivered: "Delivered",
  ht_st_done: "Done",
  // Shared consent-receipt chrome (components/ui.tsx)
  consent_title: "Who sees this & for how long",
  consent_who: "Who sees",
  consent_what: "What they see",
  consent_howlong: "How long",
  consent_stop: "How to stop",
  // Welcome overlay: v1 keeps the owner preface in EN; this note is honest.
  welcome_es_soon: "Espanol proximamente · Spanish coming soon.",
} as const;

export type I18nKey = keyof typeof EN;

/* ── Spanish (v1 — plain, calm; missing keys fall back to EN) ──── */

const ES: Partial<Record<I18nKey, string>> = {
  nav_home: "Inicio",
  nav_help: "Buscar ayuda",
  nav_sweeps: "Desalojos",
  nav_checkin: "Estoy bien",
  fast_exit: "Salida rápida",
  fast_exit_label: "Salida rápida — salir de SafeGround ahora",
  menu_title: "Menú",
  menu_hometeam: "HomeTeam — ayuda a un vecino",
  menu_about: "Acerca de y privacidad",
  menu_welcome: "Bienvenida — qué es SafeGround",
  menu_queue: "Solicitudes de apoyo (equipo)",
  menu_notify: "Prueba de avisos (equipo)",
  menu_crisis: "Recursos de crisis",
  menu_signin: "Entrar",
  menu_signout: "Salir",
  menu_signed_in_as: "Sesión como",
  crisis_title: "Hablar con alguien",
  crisis_intro:
    "No estás a solas esta noche. Estas líneas son gratis y privadas, y contestan personas que escuchan.",
  crisis_call: "Llama o escribe al 988 — Suicide & Crisis Lifeline",
  crisis_chat: "Chatea en línea en 988lifeline.org",
  crisis_outro: "Sin prisa y sin presión — esto queda aquí para cuando lo necesites.",
  cat_food: "Comida",
  cat_shelter: "Refugio",
  cat_water: "Agua",
  cat_showers: "Duchas",
  cat_clinics: "Clínicas",
  cat_charging: "Carga",
  cat_legal: "Legal",
  cat_daycenters: "Centros de día",
  cat_transportation: "Transporte",
  cat_emergency: "Ayuda en crisis",
  catname_food: "Comida",
  catname_shelter: "Refugio y descanso",
  catname_water: "Agua",
  catname_showers: "Baños y duchas",
  catname_clinics: "Salud y clínicas",
  catname_charging: "Carga y Wi-Fi",
  catname_legal: "Ayuda legal",
  catname_daycenters: "Centros de día",
  catname_transportation: "Transporte",
  catname_emergency: "Ayuda en crisis",
  help_chips: "Categorías — elige para filtrar",
  help_search: "Buscar por nombre o lugar…",
  help_list: "Lista",
  help_map: "Mapa",
  ps_title: "Pedir apoyo de un compañero",
  ps_sub: "Con un toque, un compañero de MPRCC te contactará. Nunca llama al 911.",
  ps_phone: "Tu número de teléfono",
  ps_phone_help: "Para que un compañero te responda. Solo queda en este teléfono y en la lista del equipo.",
  ps_phone_bad: "Ese número parece incompleto — revísalo sin prisa.",
  ps_need_phone: "Primero un número completo — sin prisa.",
  ps_name: "Tu primer nombre (opcional)",
  ps_name_ph: "Tu primer nombre",
  ps_note: "¿Algo que quieres contarles? (opcional)",
  ps_note_help: "Hasta 500 letras — solo lo ve el equipo",
  ps_note_ph: "p. ej. En las tardes, estoy cerca de la biblioteca…",
  ps_submit: "Pedir apoyo",
  ps_who: "Jenn y Bambi, equipo de MPRCC — las únicas dos personas avisadas",
  ps_what: "Tu teléfono, tu nombre si lo diste, y tu mensaje",
  ps_how: "Queda en la lista del equipo hasta marcarse listo",
  ps_stop: "Nada se comparte hasta que toques abajo",
  ps_ready: "¿Enviar ahora?",
  ps_ready_sub: "Aún no se ha enviado nada — esto sigue siendo tuyo.",
  ps_call: "Te llamarán al",
  ps_yourname: "Tu nombre",
  ps_yournote: "Tu mensaje",
  ps_scope: "Solo llega a Jenn y Bambi del equipo de MPRCC. Nunca al 911, nunca a nadie más.",
  ps_yes: "Sí — pedir apoyo",
  ps_notyet: "Aún no — quiero cambiar algo",
  ps_done: "Un compañero de MPRCC te contactará. Estamos aquí.",
  ps_done_a: "El equipo recibió tu solicitud y te contactará al número que diste.",
  ps_done_b: "Tu solicitud está en la lista del equipo — un compañero te contactará en cuanto pueda.",
  ps_done_privacy: "Esto queda entre tú y el equipo de MPRCC — nunca el 911, nunca nadie más.",
  ps_home: "Volver al inicio",
  ht_sub: "Los vecinos comparten lo que necesitan — quienes apoyan ayudan cuando pueden.",
  ht_join: "Unirse al HomeTeam",
  ht_log: "Anotar una necesidad",
  ht_log_for: "Anotar una necesidad por alguien",
  ht_what: "Lo que se necesita",
  ht_what_ph: "carpa, calcetines, pase de bus",
  ht_what_help: "Separados por comas — p. ej. carpa, bolsa de dormir.",
  ht_else: "Algo más que debamos saber (opcional)",
  ht_else_ph: "Dónde llevarlo, qué funciona mejor — en general.",
  ht_pickup: "Dónde entregar (opcional)",
  ht_pickup_ph: "p. ej. cerca de la biblioteca",
  ht_who: "Quién puede ver esto",
  ht_vis_open: "Cualquiera puede ayudar",
  ht_vis_assign: "Coordina el equipo",
  ht_vis_private: "Privado",
  ht_priv_note: "Lo privado queda entre el vecino y el equipo.",
  ht_share: "Compartir la necesidad",
  ht_first_win: "Quien primero lo toma ayuda — el vecino ve quién va y cuándo llega.",
  ht_claim: "Yo me encargo",
  ht_deliver: "Marcar entregado",
  ht_claimed_me: "Ya eres la ayuda — el vecino puede verte.",
  ht_helping_on_it: "ya va en camino",
  ht_private_line: "Coordinado en privado por el equipo — gracias por mirar.",
  ht_now: "Necesidades ahora",
  ht_handling: "En camino",
  ht_delivered_sec: "Entregadas",
  ht_none: "No hay necesidades abiertas ahora",
  ht_none_body: "Cuando un vecino comparta lo que necesita, aparecerá aquí.",
  ht_supporting_as: "Apoyando como",
  ht_your_number: "Tu número:",
  ht_pause: "Pausar",
  ht_outreach_line: "Equipo — también puedes anotar necesidades por vecinos.",
  ht_add_phone: "Para tomar o compartir una necesidad, agrega tu número — queda en este teléfono.",
  ht_phone_req: "Necesario para anotar — cada necesidad lleva un número real.",
  ht_no_loc: "Tu ubicación nunca se comparte, y las necesidades se borran al entregarse.",
  ht_join_intro: "Los vecinos comparten lo que necesitan, y quienes apoyan ayudan — solo lo compartido, solo cuando lo piden.",
  ht_join_phone: "Tu teléfono",
  ht_join_phone_help: "Solo para reconocerte como apoyo — nunca se muestra a extraños.",
  ht_join_name: "Tu nombre",
  ht_join_name_ph: "Con el primer nombre basta",
  ht_join_name_help: "Así te verán las personas a quienes ayudas.",
  ht_ah: "Avisarme fuera de horario",
  ht_ah_sub: "Alertas fuera de 8am–6pm lun–vie. Apagado por defecto.",
  ht_join_no_loc: "Nunca se comparte ubicación, y no hay cuenta ni app que instalar.",
  ht_their_phone: "Su teléfono",
  ht_their_phone_ph: "10 dígitos, p. ej. 4155550142",
  ht_their_phone_help: "El equipo anota por el vecino — la necesidad queda a su nombre.",
  ht_their_name: "Su nombre",
  ht_their_name_help: "Primer nombre, como prefieran.",
  ht_st_open: "Abierta",
  ht_st_claimed: "Tomada",
  ht_st_progress: "Ayuda en camino",
  ht_st_delivered: "Entregada",
  ht_st_done: "Completada",
  consent_title: "Quién ve esto y por cuánto tiempo",
  consent_who: "Quién ve",
  consent_what: "Qué ven",
  consent_howlong: "Cuánto tiempo",
  consent_stop: "Cómo detener",
  welcome_es_soon: "Espanol proximamente · Spanish coming soon.",
};

/* ── Lookup (EN fallback — never blank) ────────────────────────── */

export function translate(lang: Lang, key: I18nKey): string {
  if (lang === "es") {
    const v = ES[key];
    if (v) return v;
  }
  return EN[key] ?? key;
}

/** Category chip + full-name labels in either language (for the /help page). */
export function categoryChipLabel(id: string, lang: Lang): string {
  return translate(lang, ("cat_" + id) as I18nKey);
}
export function categoryFullName(id: string, lang: Lang): string {
  return translate(lang, ("catname_" + id) as I18nKey);
}

/** Need-status badge key (hometeam NeedStatus -> dict key). */
export function needStatusKey(status: string): I18nKey {
  switch (status) {
    case "claimed":
      return "ht_st_claimed";
    case "in_progress":
      return "ht_st_progress";
    case "delivered":
      return "ht_st_delivered";
    case "fulfilled":
      return "ht_st_done";
    case "open":
    default:
      return "ht_st_open";
  }
}

/* ── Language store (localStorage-backed, cross-tab aware) ─────── */

function readStored(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

let current: Lang = typeof window === "undefined" ? "en" : readStored();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* one bad subscriber never breaks the toggle */
    }
  });
}

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  current = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* private mode — the toggle still works for this visit */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LANG_KEY) {
      const next: Lang = e.newValue === "es" ? "es" : "en";
      current = next;
      if (typeof document !== "undefined") {
        document.documentElement.lang = current;
      }
      emit();
    }
  });
}

/** Hook: current language + setter + t() lookup with EN fallback. */
export function useLanguage(): { lang: Lang; setLang: (l: Lang) => void; t: (key: I18nKey) => string } {
  const lang = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
    () => "en",
  );
  return { lang, setLang, t: (key: I18nKey) => translate(lang, key) };
}
