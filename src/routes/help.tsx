/**
 * Resource Navigator (WIREFRAMES §2 / PRD F1).
 * Anonymous-first: list view default + offline-safe; map is a graceful
 * fallback pane when no key (Mapbox placeholder wired in a later wave).
 * Copy verbatim; privacy: location only on the explicit "once" tap.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "~/components/shell";
import {
  Button,
  ChipGrid,
  EmptyState,
  IconTile,
  ListRow,
  LocationOnceButton,
  OfflineBanner,
  SearchField,
  SkeletonRows,
  VerifiedMark,
  useToasts,
  StatusBadge,
} from "~/components/ui";
import { ResourceSheet } from "~/components/resourceSheet";
import {
  CATEGORIES,
  CATEGORY_MAP,
  categoryOf,
  demoNearMePoint,
  withDemoDistances,
} from "~/lib/data";
import type { CategoryId, DemoResource } from "~/lib/data";
import { listResources } from "~/lib/server";
import type { ResourceRow, DataSource } from "~/lib/server";
import { ChevronRightIcon } from "~/lib/icons";
import { cn } from "~/lib/cn";

/* Live fetch from the database via the listResources server fn (demo fallback
 * inside the fn keeps this offline-safe; `source` drives the honest label). */
function useResources(): {
  resources: ResourceRow[];
  loading: boolean;
  offline: boolean;
  source: DataSource;
  retry: () => void;
} {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [source, setSource] = useState<DataSource>("demo");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setOffline(false);
    listResources()
      .then((res) => {
        if (!alive) return;
        setResources(res.rows);
        setSource(res.source);
        setLoading(false);
        if (typeof navigator !== "undefined" && !navigator.onLine) setOffline(true);
      })
      .catch(() => {
        if (!alive) return;
        setResources([]);
        setSource("demo");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);
  return { resources, loading, offline, source, retry: () => setTick((t) => t + 1) };
}

/** ResourceRow (DB shape, nullable fields) → the DemoResource view the existing
 * UI consumes. Absent fields render as "Not confirmed yet — call ahead if you
 * can" via the unconfirmed mechanism — never blank, never invented. */
function adapt(row: ResourceRow): DemoResource {
  const unconfirmed: DemoResource["unconfirmed"] = [];
  if (!row.address) unconfirmed.push("address");
  if (!row.hours) unconfirmed.push("hours");
  if (!row.phone) unconfirmed.push("phone");
  if (!row.note) unconfirmed.push("note");
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address ?? "",
    hours: row.hours ?? "",
    phone: row.phone ?? undefined,
    note: row.note ?? "",
    unconfirmed: unconfirmed.length > 0 ? unconfirmed : undefined,
    verifiedAt: row.verifiedAt ?? "",
    verifiedBy: "outreach",
    openNow: row.openNow,
    lat: row.lat,
    lng: row.lng,
  };
}

/* ── List | Map toggle (ARIA tabs, arrow-key navigable) ─────────── */
function ViewTabs({
  view,
  onChange,
  tabRefs,
}: {
  view: "list" | "map";
  onChange: (v: "list" | "map") => void;
  tabRefs: RefObject<Array<HTMLButtonElement | null>>;
}) {
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const tabs = tabRefs.current ?? [];
    const i = tabs.indexOf(e.currentTarget);
    if (i === -1) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next !== null) {
      e.preventDefault();
      tabs[next]?.focus();
      onChange(next === 0 ? "list" : "map");
    }
  };
  return (
    <div className="flex rounded-[12px] border border-sg-line bg-sg-card p-1" role="tablist" aria-label="View">
      {(["list", "map"] as const).map((v, i) => (
        <button
          key={v}
          ref={(el) => {
            if (tabRefs.current) tabRefs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`view-tab-${v}`}
          aria-selected={view === v}
          aria-controls="view-pane"
          tabIndex={view === v ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={onKey}
          className={cn(
            "flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[10px] text-btn font-medium transition-colors",
            view === v ? "bg-sg-sage text-white" : "text-sg-ink-soft hover:text-sg-ink",
          )}
        >
          {v === "list" ? "List" : "Map"}
        </button>
      ))}
    </div>
  );
}

/* ── Map pane: graceful fallback when no key / offline ──────────── */
function MapPane({
  near,
  all,
  onShowList,
  onPick,
  paneRef,
}: {
  near: { lat: number; lng: number } | null;
  all: ResourceRow[];
  onShowList: () => void;
  onPick: (r: DemoResource) => void;
  paneRef: RefObject<HTMLDivElement | null>;
}) {
  const [pins, setPins] = useState<DemoResource[]>([]);
  useEffect(() => {
    setPins(withDemoDistances(all.map(adapt), near ?? demoNearMePoint()).sort((a, b) => (a.distanceMi ?? 0) - (b.distanceMi ?? 0)).slice(0, 4));
  }, [near, all]);

  return (
    <div ref={paneRef} tabIndex={-1} role="tabpanel" id="view-pane" aria-label="Map view" className="outline-none">
      <div className="relative flex h-[320px] flex-col overflow-hidden rounded-[16px] border border-sg-line bg-sg-sky-wash">
        {/* Calm abstract "map" backdrop — grid + water, no data, no surveillance feel */}
        <div aria-hidden className="absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(42,107,138,0.18) 0 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(42,107,138,0.14) 0 1px, transparent 1px), linear-gradient(180deg, #e0eff5, #d6e9f2)", backgroundSize: "26px 26px, 40px 40px, 100% 100%" }} />
        {/* A few demo pins (sky tiles with category glyph): calm, never real-looking */}
        <div className="absolute inset-0 flex flex-wrap items-start justify-around p-4 pt-8" aria-hidden>
          {pins.map((r) => (
            <span key={r.id} className="mt-2 flex h-7 w-7 items-center justify-center rounded-[8px] border-2 border-white bg-sg-sky text-white shadow-md" style={pins.length > 5 ? { transform: "translateX(-8px)" } : undefined}>
              {categoryOf(r.category).icon && <span className="[&_svg]:h-4 [&_svg]:w-4">{categoryOf(r.category).icon}</span>}
            </span>
          ))}
        </div>
        {/* Legend chip */}
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-sg-card px-3 py-1.5 text-small font-medium text-sg-ink shadow-md">
          <span className="h-2.5 w-2.5 rounded-[4px] bg-sg-sky" aria-hidden />
          Resource
        </span>
        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-[12px] border border-sg-line bg-sg-card shadow-md">
          <button type="button" aria-label="Zoom in" className="flex h-12 w-12 items-center justify-center text-sg-ink hover:bg-sg-paper">+</button>
          <button type="button" aria-label="Zoom out" className="flex h-12 w-12 items-center justify-center border-t border-sg-line text-sg-ink hover:bg-sg-paper">−</button>
        </div>
        {/* Fallback panel — design-exact copy (WIREFRAMES §2c, DESIGN_SYSTEM §4.4) */}
        <div className="absolute inset-x-4 bottom-16 rounded-[12px] bg-sg-card p-3 shadow-md">
          <p className="text-small text-sg-ink-soft">The map needs a connection — the list below has everything.</p>
          <Button variant="text" onClick={onShowList} className="!min-h-[40px] px-0">
            Show list
          </Button>
        </div>
      </div>
      {/* Peek sheet: nearest few as rows */}
      <div className="mt-3 flex flex-col rounded-t-[16px] border border-sg-line bg-sg-card">
        <div className="flex items-center justify-center pt-2" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-sg-line" />
        </div>
        <ul className="flex flex-col">
          {pins.length === 0 ? (
            <li className="px-4 py-4 text-small text-sg-ink-soft">Loading nearby places…</li>
          ) : (
            pins.map((r) => (
              <ListRow key={r.id} onClick={() => onPick(r)}>
                <IconTile wash={categoryOf(r.category).wash}>{categoryOf(r.category).icon}</IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-sg-ink">{r.name}</span>
                  <span className="block text-small text-sg-ink-soft">
                    {CATEGORY_MAP[r.category].name} · {r.distanceMi?.toFixed(1)} mi
                    {r.openNow ? " · open now" : ""}
                  </span>
                </span>
                <ChevronRightIcon size={18} className="shrink-0 text-sg-ink-soft" aria-hidden />
              </ListRow>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/* ── Navigator page ─────────────────────────────────────────────── */
function NavigatorPage() {
  const { resources, loading, offline, source, retry } = useResources();
  const { push } = useToasts();
  const [selected, setSelected] = useState<CategoryId[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [openResource, setOpenResource] = useState<DemoResource | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paneRef = useRef<HTMLDivElement | null>(null);

  /* Roving focus per ARIA tabs pattern: after switching views, focus moves
   * to the pane (Map) or back to the selected tab (List). preventScroll —
   * never yank the reader's position around. */
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (view === "map") {
        paneRef.current?.focus({ preventScroll: true });
      } else {
        tabRefs.current[0]?.focus({ preventScroll: true });
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [view]);

  const adapted = useMemo(() => resources.map(adapt), [resources]);
  const filtered = useMemo(() => {
    let list = adapted;
    if (selected.length > 0) list = list.filter((r) => selected.includes(r.category));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q) || CATEGORY_MAP[r.category].name.toLowerCase().includes(q));
    }
    if (near) list = withDemoDistances(list, near).sort((a, b) => (a.distanceMi ?? 0) - (b.distanceMi ?? 0));
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [adapted, selected, query, near]);

  const openNow = filtered.filter((r) => r.openNow).length;
  const chips = CATEGORIES.map((c) => ({ value: c.id, label: c.label, icon: c.icon }));

  const locationOnce = () => {
    const done = () => {
      setNear(demoNearMePoint());
      push({ kind: "success", message: "Sorted by distance once — nothing was stored." });
    };
    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(done, done, { maximumAge: 0, timeout: 8000 });
    } else done();
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header>
          <h1 className="text-h1">Find help</h1>
          <p className="mt-0.5 text-small text-sg-ink-soft">Find food, rest, and care — no account needed.</p>
        </header>

        <SearchField value={query} onChange={setQuery} placeholder="Search name or place…" />

        {/* List | Map toggle — directly under search (WIREFRAMES §2a order,
         * lifted above the fold so the fixed bottom nav can never occlude it) */}
        <ViewTabs view={view} onChange={setView} tabRefs={tabRefs} />

        <div>
          <ChipGrid label="Categories — choose any to filter" options={chips} selected={selected} onToggle={(v) => setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))} />
        </div>

        <LocationOnceButton onClick={locationOnce} />

        {offline && <OfflineBanner message="No connection — showing saved list. It's all here." onRetry={retry} />}

        {view === "map" ? (
          <MapPane near={near} all={resources} onShowList={() => setView("list")} onPick={setOpenResource} paneRef={paneRef} />
        ) : (
          <section id="view-pane" role="tabpanel" aria-label="List view" className="outline-none">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <p className="text-small text-sg-ink-soft">
                {filtered.length} {filtered.length === 1 ? "place" : "places"} · open now: {openNow}
              </p>
              <p className="text-small text-sg-ink-soft">
                {source === "db" ? "Live database" : "Demo data"}
              </p>
            </div>

            {loading ? (
              <SkeletonRows rows={3} />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={`No ${selected.length === 1 ? CATEGORY_MAP[selected[0]].name.toLowerCase() : ""} found nearby yet`}
                body="Try another category or clear your search — the list refreshes anytime."
                steps={
                  <>
                    <Button variant="secondary" full onClick={() => { setSelected([]); setQuery(""); }}>
                      Clear filters
                    </Button>
                    <Button variant="text" full onClick={() => { setSelected([]); setQuery(""); setView("list"); }}>
                      See all resources
                    </Button>
                  </>
                }
              />
            ) : (
              <ul className="flex flex-col">
                {filtered.map((r) => {
                  const cat = categoryOf(r.category);
                  return (
                    <ListRow key={r.id} onClick={() => setOpenResource(r)}>
                      <IconTile wash={cat.wash}>{cat.icon}</IconTile>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-sg-ink">{r.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1 text-small text-sg-ink-soft">
                          <span>{cat.name}</span>
                          {r.distanceMi !== undefined ? <span>· {r.distanceMi.toFixed(1)} mi</span> : null}
                          <span>· {r.openNow ? "Open till " + r.hours.split("·").pop()?.trim() : "Open " + r.hours.split("·")[0].trim()}</span>
                          {r.verifiedAt ? <VerifiedMark label="Verified" /> : null}
                        </span>
                      </span>
                      <span className="shrink-0 pl-2">
                        {r.openNow ? <StatusBadge kind="Okay">Okay</StatusBadge> : null}
                        <ChevronRightIcon size={18} className="mt-1 text-sg-ink-soft" aria-hidden />
                      </span>
                    </ListRow>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      <ResourceSheet
        resource={openResource}
        onClose={() => setOpenResource(null)}
        onDirections={(r) => {
          const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(r.name + ", " + CATEGORY_MAP[r.category].name)}`;
          if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
          push({ kind: "info", message: "Opening directions in maps." });
        }}
      />
    </AppShell>
  );
}

export const Route = createFileRoute("/help")({ component: NavigatorPage });