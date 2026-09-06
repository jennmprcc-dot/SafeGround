/**
 * Resource Navigator (WIREFRAMES §2 / PRD F1) — resources-real wave.
 * Anonymous-first: list + REAL map (Leaflet + OpenStreetMap tiles — keyless,
 * free tier, no token needed). Tapping a card/pin opens full details (address,
 * phone, hours, note) with "Get directions" opening the phone's own Maps.
 * Admins (Jenn + Bambi) get an "Add resource" control; the save is gated
 * server-side (outreach_roster role='admin'), never just a hidden button.
 * Copy calm/trauma-informed; privacy: no location request unless tapped.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ResourceMapPane } from "~/components/resourceMap";
import { ResourceAddSheet } from "~/components/resourceAddSheet";
import {
  CATEGORIES,
  CATEGORY_MAP,
  categoryOf,
  demoNearMePoint,
  withDemoDistances,
} from "~/lib/data";
import type { CategoryId, DemoResource } from "~/lib/data";
import { listResources, isAdminPhone } from "~/lib/server";
import type { ResourceRow, DataSource } from "~/lib/server";
import { getAlertIdentity } from "~/lib/alertIdentity";
import { PlusIcon, ChevronRightIcon } from "~/lib/icons";
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
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
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

/* ── Navigator page ─────────────────────────────────────────────── */
function NavigatorPage() {
  const { resources, loading, offline, source, retry } = useResources();
  const { push } = useToasts();
  const [selected, setSelected] = useState<CategoryId[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "map">("list");
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [openResource, setOpenResource] = useState<DemoResource | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const paneRef = useRef<HTMLDivElement | null>(null);

  /* Phone identity (same as alerts/hometeam). Admin check is a UI hint —
   * the server re-checks the roster authoritatively on every save. */
  useEffect(() => {
    const ident = getAlertIdentity();
    if (!ident?.phone) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    isAdminPhone({ data: { phone: ident.phone } })
      .then((r) => {
        if (alive) setIsAdmin(r.isAdmin);
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* Roving focus per ARIA tabs pattern. preventScroll — never yank the
   * reader's position around. */
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

  /* Get directions — opens the phone's own Maps app (geo: on Android,
   * maps.apple.com on iOS), falling back to a web maps URL for desktop. */
  const openDirections = useCallback((r: DemoResource) => {
    const q = r.address ? r.address : r.name;
    const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);
    const url = isIOS
      ? `maps.apple.com/?daddr=${encodeURIComponent(q)}`
      : isAndroid
        ? `geo:0,0?q=${encodeURIComponent(q)}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
    push({ kind: "info", message: "Opening directions in your Maps app." });
  }, [push]);

  const refresh = retry;

  return (
    <AppShell>
      <div className="flex flex-col gap-4 px-4 pt-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-h1">Find help</h1>
            <p className="mt-0.5 text-small text-sg-ink-soft">Find food, rest, and care — no account needed.</p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-1 inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[12px] bg-sg-sage px-3.5 text-btn font-semibold text-white shadow-sm transition-colors hover:bg-sg-sage-deep"
              aria-label="Add a resource — outreach admins only"
            >
              <PlusIcon size={18} aria-hidden />
              Add
            </button>
          ) : null}
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
          <ResourceMapPane
            resources={filtered.map((r) => ({ id: r.id, name: r.name, category: r.category, lat: r.lat ?? null, lng: r.lng ?? null }))}
            selectedId={openResource?.id ?? null}
            paneRef={paneRef}
            onPick={(id) => {
              const row = adapted.find((r) => r.id === id);
              if (row) setOpenResource(row);
            }}
          />
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
                          {r.hours ? <span>· {r.hours.split("·")[0].trim()}</span> : null}
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
        onDirections={openDirections}
      />
      {isAdmin ? (
        <ResourceAddSheet
          open={addOpen}
          phone={getAlertIdentity()?.phone ?? ""}
          onClose={() => setAddOpen(false)}
          onSaved={refresh}
        />
      ) : null}
    </AppShell>
  );
}

export const Route = createFileRoute("/help")({ component: NavigatorPage });
