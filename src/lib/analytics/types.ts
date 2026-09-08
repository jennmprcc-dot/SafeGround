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
  | "check_in";
