/**
 * REAL Marin County resource seed data (owner-provided — /home/team/shared/MARIN_RESOURCES.md,
 * compiled 2026-09-06). This REPLACES the fictional demo resources in the live
 * database. Every entry is public-listing sourced; ⭐ = owner-requested (MPRCC).
 *
 * MPRCC still confirms hours/addresses before public launch — the UI says
 * "call ahead if you can" wherever the source says unconfirmed (hours text
 * carries that, calm and plain).
 *
 * lat/lng: approximate geocodes from the addresses (map pins); null where the
 * listing itself says "call for exact location" — no invented pins.
 */

export interface MarinResource {
  /** Deterministic seed id (uuid5("resource:" + id) in bootstrap). */
  id: string;
  name: string;
  category:
    | "food"
    | "shelter"
    | "water"
    | "showers"
    | "clinics"
    | "charging"
    | "legal"
    | "daycenters"
    | "transportation"
    | "emergency";
  address: string | null;
  hours: string;
  phone: string | null;
  /** What to expect — plain-language, calm. */
  note: string;
  lat: number | null;
  lng: number | null;
  /** Owner-requested entry (MPRCC ⭐) — never dropped in reseed waves. */
  ownerRequested?: boolean;
}

/** All entries verified/compiled 2026-09-06 (listing date). */
export const MARIN_VERIFIED_AT = "2026-09-06";

export const REAL_MARIN_RESOURCES: MarinResource[] = [
  // ── FOOD ────────────────────────────────────────────────────────
  {
    id: "marin-svdp-dining-room",
    name: "St. Vincent de Paul — Free Dining Room",
    category: "food",
    address: "820 B Street, San Rafael, CA 94901",
    hours: "Every day of the year 7am–1pm (breakfast 7–8, lunch 11–1; dinner to-go at lunch)",
    phone: "(415) 454-3303",
    note: "Hot meals and companionship, 365 days a year. Spanish-speaking volunteers available. Basic items (blanket, socks, toiletries) at the Help Desk.",
    lat: 37.9745,
    lng: -122.5296,
  },
  {
    id: "marin-hamilton-meals",
    name: "Hamilton Encampment Community Meals",
    category: "food",
    address: "Hamilton encampment, Novato, CA (meals served at the encampment site)",
    hours: "Sundays 4:30pm · Wednesdays 5:30pm",
    phone: null,
    note: "Community meals served at the Hamilton encampment twice a week — Sundays 4:30pm, Wednesdays 5:30pm. Open to neighbors; food + company in a welcoming setting.",
    lat: 38.073,
    lng: -122.513,
    ownerRequested: true,
  },
  {
    id: "marin-ritter-market",
    name: "Ritter Center — Community Market (food pantry)",
    category: "food",
    address: "16 Ritter St, San Rafael, CA 94901 (Ritter is moving to 800 A St — verify current address)",
    hours: "Call for pantry hours (site shows M/Tu 9–12 & 1–3, W 9–3, Th closed, F 9–12)",
    phone: "(415) 457-8182",
    note: "Largest food pantry in Marin; fresh produce + staples; free to people facing poverty. Call ahead if you can — Ritter is moving.",
    lat: 37.9766,
    lng: -122.5323,
  },
  {
    id: "marin-nmcs-pantry",
    name: "North Marin Community Services — Weekly Food Pantry",
    category: "food",
    address: "1907 Novato Blvd, Novato, CA 94947",
    hours: "Tuesdays 1–3pm (registration weekdays 9am–5pm)",
    phone: "(415) 897-4147",
    note: "Food pantry for low-income Novato residents. Currently at capacity — new registrations go on a waiting list; call first.",
    lat: 38.0834,
    lng: -122.5712,
  },
  {
    id: "marin-mcc-food-hubs",
    name: "Marin Community Clinics — Free Food Distribution",
    category: "food",
    address: "San Rafael (Wednesdays) / Novato (Thursdays) — call for exact hub locations",
    hours: "Wed in San Rafael · Thu in Novato (call to confirm times)",
    phone: "(415) 448-1500",
    note: "Free food distribution twice a week. Call to confirm times and locations.",
    lat: null,
    lng: null,
  },
  // ── SHELTER ─────────────────────────────────────────────────────
  {
    id: "marin-jonathans-place",
    name: "Homeward Bound of Marin — Jonathan's Place",
    category: "shelter",
    address: "190 Mill St, San Rafael, CA 94901",
    hours: "Call the shelter team to request services",
    phone: "(415) 457-9651",
    note: "38-bed adult shelter (housing-focused). Request shelter services by phone; connection to benefits and housing planning.",
    lat: 37.9718,
    lng: -122.5265,
  },
  {
    id: "marin-new-beginnings",
    name: "Homeward Bound of Marin — New Beginnings Center",
    category: "shelter",
    address: "1399 N Hamilton Pkwy, Novato, CA 94949",
    hours: "Call to request services",
    phone: "(415) 382-3363",
    note: "80-bed adult shelter on the former military base campus; meals, counseling, job/housing help, Fresh Starts Culinary Academy, VA office for veterans.",
    lat: 38.0998,
    lng: -122.514,
  },
  {
    id: "marin-hb-family-center",
    name: "Homeward Bound of Marin — Family Center",
    category: "shelter",
    address: "San Rafael, CA (call for exact address)",
    hours: "Call to request services",
    phone: "(415) 457-2115",
    note: "Shelter for nine families in a shared home in San Rafael.",
    lat: null,
    lng: null,
  },
  {
    id: "marin-svdp-housing-desk",
    name: "St. Vincent de Paul — Housing Help Desk (Coordinated Entry)",
    category: "shelter",
    address: "747 B Street (above the Free Dining Room), San Rafael, CA 94901",
    hours: "Drop-in Wed 1:30–3:30pm · by phone Mon–Fri 9am–5pm",
    phone: "(415) 454-3303 ext. 25",
    note: "First step for shelter/housing help: intake assessment, Coordinated Entry, rapid rehousing, CalWORKs. No appointment needed Wed drop-in; must be experiencing homelessness in Marin.",
    lat: 37.9741,
    lng: -122.5294,
  },
  // ── CLINICS ─────────────────────────────────────────────────────
  {
    id: "marin-ritter-clinic",
    name: "Ritter Center — Medical Clinic",
    category: "clinics",
    address: "16 Ritter St, San Rafael, CA 94901",
    hours: "Mon–Fri 8am–12pm & 1pm–4:30pm (walk-ins welcome; appointments encouraged)",
    phone: "(415) 504-1830 (24/7)",
    note: "Free/sliding-scale primary care (FQHC, Health Care for the Homeless site); behavioral health and substance-use counseling on site. Masks required. If medical emergency, call 911.",
    lat: 37.9766,
    lng: -122.5323,
  },
  {
    id: "marin-mcc-downtown",
    name: "Marin Community Clinics — Downtown San Rafael (Vivalon Campus)",
    category: "clinics",
    address: "999 Third St, San Rafael, CA 94901",
    hours: "Mon/Tue/Thu/Fri 8–5; 1st/3rd Wed 8–5; 2nd/4th/5th Wed 9–5; closed daily 12–1",
    phone: "(415) 448-1500",
    note: "Adult primary care, behavioral health, family planning; sliding-fee discount available; uninsured welcome.",
    lat: 37.9777,
    lng: -122.5292,
  },
  {
    id: "marin-mcc-novato",
    name: "Marin Community Clinics — Novato Campus (dental + pharmacy)",
    category: "clinics",
    address: "6100 Redwood Blvd, Novato, CA 94945",
    hours: "Call for hours",
    phone: "(415) 448-1500",
    note: "Dental and pharmacy onsite; sliding-fee discount; accepts Medi-Cal, Medicare, Covered CA.",
    lat: 38.0752,
    lng: -122.557,
  },
  {
    id: "marin-bhrs-access",
    name: "Marin BHRS — Behavioral Health & Recovery Services (Access Line)",
    category: "clinics",
    address: "20 North San Pedro Rd, Suite 2021, San Rafael, CA 94903",
    hours: "Access Line 24/7 · office Mon–Fri 8am–5pm",
    phone: "Access Line (888) 818-1115 (24/7) · office (415) 473-6769",
    note: "Marin County behavioral health & substance-use support — call anytime to talk, get screened, or find services, for you or someone you care about. Free, confidential, no wrong door. Also: 988 (Suicide & Crisis Lifeline) · text HOME to 741741.",
    lat: 37.996,
    lng: -122.5285,
    ownerRequested: true,
  },
  // ── LEGAL ───────────────────────────────────────────────────────
  {
    id: "marin-legal-aid",
    name: "Legal Aid of Marin",
    category: "legal",
    address: "1401 Los Gamos Dr, Suite 101, San Rafael, CA 94903",
    hours: "Call for intake hours",
    phone: "(415) 492-0230",
    note: "Free civil legal services: housing/tenant rights, eviction defense, employment, Community Court. Marin residents.",
    lat: 37.9935,
    lng: -122.5428,
  },
  {
    id: "marin-baylegal",
    name: "Bay Area Legal Aid — Marin County Office",
    category: "legal",
    address: "30 N San Pedro Rd, Suite 250, San Rafael, CA 94903",
    hours: "Advice line for housing/public-benefits/consumer law",
    phone: "(415) 354-6360 · 800-551-5554 (Legal Advice Line)",
    note: "Free legal help: homelessness prevention, landlord-tenant, fair housing. Income eligibility required — call the advice line to check. Spanish/Chinese/Vietnamese spoken.",
    lat: 37.996,
    lng: -122.529,
  },
  // ── SHOWERS / HYGIENE ───────────────────────────────────────────
  {
    id: "marin-ritter-showers",
    name: "Ritter Center — Shower, Laundry, Restrooms, Mail",
    category: "showers",
    address: "16 Ritter St, San Rafael, CA 94901 (verify — moving soon)",
    hours: "Mon–Fri 8:30am–12:30pm & 1:30pm–4:30pm (verify — moving soon)",
    phone: "(415) 457-8182",
    note: "Free shower, laundry, restroom facilities; general delivery mail and voicemail boxes. All services free to people experiencing poverty.",
    lat: 37.9766,
    lng: -122.5323,
  },
  {
    id: "r-bethany-project",
    name: "The Bethany Project Marin — Showers, Laundry & Food Pantry",
    category: "showers",
    address: "5400 Nave Dr, Novato, CA 94949 (Hamilton Community Church)",
    hours: "Thursdays 1:30–4pm",
    phone: "(628) 307-7103",
    note: "Free showers + laundry (drop a bag, pick it up washed & folded), food pantry, warm drinks, peer counselors with lived experience. A welcoming community in Novato. Launched Jan 2025 at Hamilton Community Church.",
    lat: 38.068,
    lng: -122.522,
    ownerRequested: true,
  },
  // ── TRANSPORTATION ──────────────────────────────────────────────
  {
    id: "marin-access-paratransit",
    name: "Marin Access — Paratransit & Mobility Help (Marin Transit)",
    category: "transportation",
    address: "3000 Kerner Blvd, San Rafael, CA 94901",
    hours: "Travel Navigators Mon–Fri 10am–4pm · trip reservations 8am–5pm, 7 days",
    phone: "(415) 454-0902 · toll-free (800) 454-0902 (outside Marin)",
    note: "Door-to-door shared rides for people who can't use the regular bus (disability or health condition). Apply for eligibility by phone — 1–7 days' notice to book a trip. Free travel help even before you're certified.",
    lat: 37.9665,
    lng: -122.539,
    ownerRequested: true,
  },
  // ── EMERGENCY (mobile crisis — never 911-dispatch) ──────────────
  {
    id: "marin-safe-team",
    name: "SAFE Team — mobile crisis response (San Rafael / Novato)",
    category: "emergency",
    address: "1323 Fifth Ave, San Rafael · also serves Novato (Tue–Sat)",
    hours: "San Rafael 8am–8pm, 7 days, 365 · Novato Tue–Sat 8am–8pm (in an emergency call 911 — dispatchers forward to SAFE when appropriate)",
    phone: "415-458-7233 (SAFE) · Novato (415) 899-7000",
    note: "A mobile crisis team of EMT + crisis specialist. They come to you for mental-health support, addiction help, or shelter needs — non-judgmental, trauma-informed, no police unless there's danger. Also proactive outreach.",
    lat: 37.9747,
    lng: -122.5245,
    ownerRequested: true,
  },
  // ── CHARGING & WI-FI (public libraries) ─────────────────────────
  {
    id: "marin-sr-library",
    name: "San Rafael Public Library",
    category: "charging",
    address: "1100 E St, San Rafael, CA 94901",
    hours: "Call for current hours (varies)",
    phone: "(415) 485-3323",
    note: "Free Wi-Fi, power outlets, restrooms, A/C — a safe public place to rest and charge. Open to everyone.",
    lat: 37.9739,
    lng: -122.522,
  },
  {
    id: "marin-novato-library",
    name: "Novato Library",
    category: "charging",
    address: "1720 Novato Blvd, Novato, CA 94947",
    hours: "Call for current hours",
    phone: "(415) 899-1260",
    note: "Free Wi-Fi, outlets, restrooms. Open to everyone.",
    lat: 38.082,
    lng: -122.572,
  },
  {
    id: "marin-civic-center-library",
    name: "Civic Center Library (Marin County Free Library)",
    category: "charging",
    address: "3501 Civic Center Dr, San Rafael, CA 94903",
    hours: "Call for current hours",
    phone: "(415) 473-6050",
    note: "Free Wi-Fi, outlets, restrooms, parking — a quiet, safe public space.",
    lat: 37.995,
    lng: -122.53,
  },
  // ── DAY CENTERS / PEER SUPPORT ──────────────────────────────────
  {
    id: "marin-mprcc",
    name: "MPRCC — Marin Peer Recovery Community Collective",
    category: "daycenters",
    address: "Online — mprcc.org (reach out via the site)",
    hours: "Peer-led collective; reach out online",
    phone: null,
    note: "MPRCC is the SafeGround outreach team — peer support, navigation, compassionate community care, guided by lived experience. 'Reach Out to Us' on mprcc.org.",
    lat: null,
    lng: null,
  },
];

/**
 * The two already-real providers from the previous wave, kept and refreshed —
 * NOT duplicated by the list above. The Street Chaplaincy keeps its live row
 * (owner-verified provider, San Rafael); Bethany appears above with the fuller
 * owner-requested data (same deterministic id, so the upsert refreshes it).
 */
export const KEPT_EXISTING_RESOURCES: MarinResource[] = [
  {
    id: "r-street-chaplaincy",
    name: "The Street Chaplaincy",
    category: "daycenters",
    address: "1510 5th Ave, San Rafael, CA 94901",
    hours: "Call ahead — support hours vary",
    phone: "(415) 685-5058",
    note: "Spiritual and wellness support with a welcoming ear — hot drinks, conversation, and a calm place to rest. Founded by Kieawnie Clar (Executive Director).",
    lat: 37.9739,
    lng: -122.529,
  },
];
