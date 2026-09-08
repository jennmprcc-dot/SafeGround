/**
 * Resource map (resources-real wave) — real map for the Navigator.
 *
 * Why Leaflet + OpenStreetMap raster tiles (NOT mapbox-gl): the live schema
 * keeps this on the free tier, and there is no Mapbox token in the platform
 * env. OSM tiles are keyless, free, and fit the existing "map is a graceful
 * pane, never a blocker" pattern (sweeps/check-ins illustrated panes).
 * If a Mapbox token is added later, only the tile URL changes:
 *   https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=TOKEN
 *
 * SSR SAFETY: leaflet touches `window` at module scope, so it must NEVER be
 * imported at the top level of a server-rendered path. It is loaded here via
 * dynamic import inside useEffect (client-only). The type imports below are
 * erased at compile time and are SSR-safe. Until the client bundle loads,
 * the pane renders the calm sky-wash placeholder.
 *
 * Calm/trauma-informed: soft circular category pins, gentle attribution,
 * tap = open the same detail sheet the list uses. No user location is ever
 * requested by the map itself (privacy: location sharing stays user-initiated).
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DivIcon, LayerGroup, Map as LeafletMap } from "leaflet";
import type { CategoryId } from "~/lib/data";

/** The leaflet module namespace, only ever loaded on the client. */
type LeafletNS = typeof import("leaflet");

/** Marbled sky-wash to show while tiles load (or offline) — calm, on-brand. */
const WASH =
  "linear-gradient(180deg, #e0eff5 0%, #d6e9f2 55%, #ddeee0 100%)";

export interface MapResource {
  id: string;
  name: string;
  category: CategoryId;
  lat: number | null;
  lng: number | null;
}

/** Small inline SVG (data URI) — soft sage disc, white pin glyph. Category
 * could tint this later; one calm color keeps the map quiet. */
function pinIcon(L: LeafletNS, _category: CategoryId): DivIcon {
  return L.divIcon({
    className: "sg-map-pin",
    html:
      `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:9999px;` +
      `background:#2f6b4f;border:2px solid #fff;box-shadow:0 2px 6px rgba(30,42,50,.35);color:#fff;">` +
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>` +
      `</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -30],
  });
}

export function ResourceMapPane({
  resources,
  selectedId,
  paneRef,
  onPick,
  height = 340,
}: {
  resources: MapResource[];
  selectedId: string | null;
  paneRef?: RefObject<HTMLDivElement | null>;
  /** Tap a pin → open the same detail sheet the list uses. */
  onPick?: (id: string) => void;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<LeafletNS | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  /* Init once, client-only: dynamically import leaflet inside the effect so
   * the SSR bundle never evaluates leaflet-src.js ("window is not defined"). */
  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host || mapRef.current) return;
    (async () => {
      try {
        const L = await import("leaflet");
        /* Leaflet CSS via dynamic import stays out of the SSR bundle too.
         * Non-fatal if it fails — the custom div pins still render. */
        try {
          await import("leaflet/dist/leaflet.css");
        } catch {
          /* styling is best-effort */
        }
        if (cancelled || mapRef.current) return;
        const el = hostRef.current;
        if (!el) return;
        const map = L.map(el, {
          center: [37.99, -122.53],
          zoom: 10,
          scrollWheelZoom: false,
          attributionControl: true,
        });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        leafletRef.current = L;
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  /* Sync markers with the filtered resource set. */
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const withPoints = resources.filter((r) => r.lat != null && r.lng != null);
    for (const r of withPoints) {
      const marker = L.marker([r.lat as number, r.lng as number], { icon: pinIcon(L, r.category) })
        .bindTooltip(r.name, { direction: "top", offset: [0, -26] })
        .on("click", () => pickRef.current?.(r.id));
      marker.addTo(layer);
    }
    if (withPoints.length > 0) {
      map.fitBounds(
        L.latLngBounds(withPoints.map((r) => [r.lat as number, r.lng as number] as [number, number])),
        { padding: [36, 36], maxZoom: 14 },
      );
    }
  }, [resources, ready]);

  /* Focus on the selected resource (from the list) with a gentle pan. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    map.closePopup();
    const row = resources.find((r) => r.id === selectedId);
    if (row?.lat != null && row?.lng != null) {
      map.setView([row.lat, row.lng], Math.max(map.getZoom(), 14), { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  if (failed) {
    return (
      <div className="flex h-[320px] flex-col items-center justify-center gap-1 rounded-[16px] border border-sg-line bg-sg-sky-wash px-4 text-center">
        <p className="text-small text-sg-ink-soft">The map couldn't load — the list below has everything.</p>
      </div>
    );
  }

  return (
    <div ref={paneRef} tabIndex={-1} role="tabpanel" id="view-pane" aria-label="Map view" className="outline-none">
      <div className="relative overflow-hidden rounded-[16px] border border-sg-line" style={{ height, background: WASH }}>
        <div ref={hostRef} className="absolute inset-0" role="region" aria-label="Map of resources" />
      </div>
      <p className="mt-1.5 px-1 text-small text-sg-ink-soft">
        {resources.some((r) => r.lat != null)
          ? `${resources.filter((r) => r.lat != null).length} places on the map — tap a pin for details.`
          : "Map pins coming as outreach confirms locations — the list has everything now."}
      </p>
    </div>
  );
}
