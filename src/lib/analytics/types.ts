/**
 * Shared anonymous-analytics event-type union (owner-directed 2026-09-07).
 *
 * TYPE-ONLY module — it imports nothing at runtime, so it is safe to import
 * from BOTH client code (~/lib/analytics/logger.ts) and server code
 * (~/lib/analytics/server.ts) without dragging any Node-only modules into the
 * browser bundle. Keep this union in sync with EVENT_TYPES in server.ts.
 */
export type AnalyticsEventType =
  | "resource_search"
  | "peer_support_request"
  | "sweep_alert_view"
  | "check_in"
  // Pass 2 — Donation Dispatch (owner-directed 2026-09-12): zero-PII, logged
  // on submit + complete. Keep in sync with EVENT_TYPES in server.ts.
  | "donation_offer_submit"
  | "donation_request_submit"
  | "donation_offer_complete"
  | "donation_request_complete"
  // Pass 3 — Volunteer flow (owner-directed 2026-09-12): zero-PII, logged on
  // submit only (category/status = contact-kind). Keep in sync with
  // EVENT_TYPES in server.ts.
  | "volunteer_submit"
  // Peer groups + group check-in send (owner-requested 2026-09-15):
  //   peer_group_created   — a group was saved (no name, no id, no members)
  //   checkin_group_send   — a check-in was shared with peers (category =
  //                          audience kind, status = member-count bucket).
  // Never a group name, a group id, a member id, a phone or a coordinate.
  | "peer_group_created"
  | "checkin_group_send"
  // Peer-to-peer texting (owner goal 2026-09-16).
  | "peer_text_send"
  | "peer_text_reply";
