/**
 * Admin "Add resource" sheet (owner-directed 2026-09-06: "BAMBI AND I SHOULD
 * HV A WAY TO ADD RESOURCES MANUALLY AS WE LEARN ABOUT THEM").
 *
 * Visible ONLY for outreach_roster role='admin' phones (Jenn + Bambi) — and the
 * save is gated AGAIN server-side (addResource re-checks the roster before the
 * insert), so this control is a convenience, never the security boundary.
 * Calm form: short labels, plain helper text, gentle errors, no required
 * fields beyond name + category. verified_by/verified_at are set server-side.
 */
import { useState } from "react";
import { BottomSheet, Button, TextArea, TextField, useToasts } from "~/components/ui";
import { CATEGORIES } from "~/lib/data";
import { addResource } from "~/lib/server";
import { cn } from "~/lib/cn";

export function ResourceAddSheet({
  open,
  phone,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The signed-in admin's normalized phone (identity re-checked server-side). */
  phone: string;
  onClose: () => void;
  /** Called after a successful save so the list can refresh. */
  onSaved: () => void;
}) {
  const { push } = useToasts();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [address, setAddress] = useState("");
  const [hours, setHours] = useState("");
  const [phoneOfResource, setPhoneOfResource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setCategory("");
    setAddress("");
    setHours("");
    setPhoneOfResource("");
    setNote("");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await addResource({
        data: {
          phone,
          name,
          category: category || undefined,
          address,
          hours,
          phoneOfResource,
          note,
        },
      });
      if (res.ok && res.source === "db") {
        push({ kind: "success", message: "Saved — it's live in Find help now." });
        reset();
        onSaved();
        onClose();
      } else if (res.ok && res.source === "demo") {
        // Held as a draft (offline) — honest about it, never appears lost.
        push({ kind: "info", message: "Saved as a draft for now — it syncs when the connection is back." });
        reset();
        onClose();
      } else {
        setError(res.error ?? "That didn't save — nothing was changed. Try again in a moment.");
      }
    } catch {
      setError("That didn't save — nothing was changed. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Add a resource">
      <div className="flex flex-col gap-4 pb-2">
        <p className="text-small text-sg-ink-soft">
          For the MPRCC outreach team. Add it as you learned it — neighbors see it right away, and
          outreach can correct it anytime.
        </p>

        <TextField
          label="Name"
          placeholder="e.g. Free Saturday breakfast"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="add-res-category" className="text-btn font-medium">
            Category
          </label>
          <select
            id="add-res-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={cn(
              "min-h-[52px] w-full rounded-[12px] border-2 bg-sg-card px-4 text-body text-sg-ink outline-none transition-colors",
              category ? "border-sg-line" : "border-sg-line text-sg-ink-soft",
            )}
          >
            <option value="">Choose the closest fit…</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <TextField
          label="Address"
          helper="Optional — as exact as you know it. Leave blank if it's 'call for location'."
          placeholder="Street, city"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={200}
        />

        <TextField
          label="Hours"
          helper="Optional — plain words are fine: 'Sundays 4:30pm'."
          placeholder="e.g. Mon–Fri 9am–5pm"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          maxLength={200}
        />

        <TextField
          label="Phone"
          helper="Optional — the number neighbors should call."
          placeholder="(415) …"
          value={phoneOfResource}
          onChange={(e) => setPhoneOfResource(e.target.value)}
          maxLength={60}
          inputMode="tel"
        />

        <TextArea
          label="What to expect"
          helper="Optional — a calm line or two helps folks know what they're walking into."
          placeholder="Warm tone, plain language…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={600}
          rows={3}
        />

        {error ? (
          <p role="alert" className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-ink">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button variant="primary" full onClick={save} disabledReason={busy ? "Saving…" : undefined} disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Save resource"}
          </Button>
          <Button variant="quiet" full onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
