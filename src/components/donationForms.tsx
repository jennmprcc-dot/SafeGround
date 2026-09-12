/**
 * Pass 2 — Donation Dispatch forms (owner-directed 2026-09-12).
 *
 * Two calm, mobile-first forms:
 *  - DonateItemForm  → /hometeam ("I Want to Help") — "Donate an item"
 *  - RequestItemForm → /help ("I Need Help") — "Request an item"
 *
 * Privacy contract (mirrors peer-support.tsx): contact_phone is REQUIRED and
 * is the ONLY way the outreach team can coordinate — shown on-device, stored
 * for staff only (roster-gated reads; no public SELECT). A calm reassurance
 * line sits under the field. Photos: client-compressed on-device via canvas to
 * ≤300KB JPEG, kept as base64 in photo_b64 — no external storage, ever.
 *
 * Submit → POST per the Pass 2 API contract (src/lib/donation.ts DONATION_API).
 * Success = a calm confirmation of what MPRCC does next: staff contact them to
 * coordinate. teamNotified=false is informational — we always say "Staff have
 * been notified"; FCM failures are never surfaced as errors.
 *
 * Client-safe: imports only ~/lib/donation (pure constants) + ui + i18n —
 * never ~/db or server modules.
 */
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ALWAYS_ACCEPTING,
  DONATION_API,
  MPRCC_PORCH,
  OFFER_PATHS,
  PICKUP_TIME_PLACEHOLDER,
  PORCH_DROP_STAFF_NOTE,
  PHOTO_B64_CAP_CHARS,
  sizePromptFor,
  type OfferPath,
  type PickupOrDelivery,
} from "~/lib/donation";
import {
  formatPhone,
  getAlertIdentity,
  normPhone,
  phoneLooksOk,
  setAlertIdentity,
} from "~/lib/alertIdentity";
import { Button, Card, ConsentReceipt, TextArea, TextField } from "~/components/ui";
import { CheckCircleIcon, CloseIcon } from "~/lib/icons";
import { useLanguage, type I18nKey } from "~/lib/i18n";
import { cn } from "~/lib/cn";

/* ── Photo compression (client-side only, on-device) ──────────────
 * Reads the file into a canvas, downscales + re-encodes JPEG until the base64
 * sits under PHOTO_B64_CAP_CHARS (≈300KB binary). Never uploads the original;
 * the compressed data URL is the photo_b64 payload. Throws a calm error when
 * the image simply can't fit. */
async function fileToPhotoB64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("decode"));
    im.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("noctx");
  let scale = Math.min(1, 1400 / Math.max(img.width, img.height, 1));
  const qualities = [0.82, 0.7, 0.55, 0.4];
  for (const q of qualities) {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", q).replace(/^data:image\/jpeg;base64,/, "");
    if (out.length <= PHOTO_B64_CAP_CHARS) return out;
    scale *= 0.7;
  }
  throw new Error("toobig");
}

/** Native select styled to match the app's TextField (no select exists in ui). */
function CategorySelect({
  label,
  value,
  onChange,
  error,
  phKey,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  phKey: I18nKey;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="dn-category" className="text-btn font-medium">{label}</label>
      <select
        id="dn-category"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={cn(
          "min-h-[52px] w-full appearance-none rounded-[12px] border-2 bg-sg-card px-4 text-body text-sg-ink outline-none transition-colors",
          error ? "border-sg-danger-gentle" : "border-sg-line focus:border-sg-ink",
          value === "" ? "text-sg-ink-soft/70" : "",
        )}
      >
        <option value="" disabled>{t(phKey)}</option>
        {ALWAYS_ACCEPTING.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {error ? <p className="text-small text-sg-danger-gentle">{error}</p> : null}
      <p className="text-small text-sg-ink-soft">{t("dn_new_only")} · {t("dn_bras_ok")}</p>
    </div>
  );
}

function RadioCard({
  checked,
  onSelect,
  title,
  sub,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  sub: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={-1}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col gap-1 rounded-[12px] border-2 bg-sg-card px-4 py-3 transition-colors",
        checked ? "border-sg-sage bg-sg-sage-wash/50" : "border-sg-line hover:bg-sg-paper",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-body font-medium text-sg-ink">{title}</span>
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
            checked ? "border-sg-sage bg-sg-sage" : "border-sg-line bg-sg-card",
          )}
        >
          {checked ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
        </span>
      </span>
      <span className="text-small text-sg-ink-soft">{sub}</span>
      {children}
    </div>
  );
}

/* ── Offer form ─────────────────────────────────────────────────── */

type OfferPhase = "form" | "done";

export function DonateItemForm() {
  const { t } = useLanguage();
  const [identity] = useState(() => getAlertIdentity());
  const [phase, setPhase] = useState<OfferPhase>("form");

  const [path, setPath] = useState<OfferPath | "">("");
  const [itemDescription, setItemDescription] = useState("");
  const [category, setCategory] = useState("");
  const [conditionNote, setConditionNote] = useState("");
  const [quantity, setQuantity] = useState("");
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [approachNotes, setApproachNotes] = useState("");
  const [pickupTimeWindow, setPickupTimeWindow] = useState("");
  const [photoB64, setPhotoB64] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const phoneOk = phoneLooksOk(phoneInput);
  const addressNeeded = path === "porch_drop" || path === "scheduled_pickup";
  const addressOk = !addressNeeded || (addressStreet.trim() !== "" && addressCity.trim() !== "" && addressZip.trim() !== "");
  const windowOk = path !== "scheduled_pickup" || pickupTimeWindow.trim() !== "";
  const canSubmit = path !== "" && category !== "" && itemDescription.trim() !== "" && phoneOk && addressOk && windowOk;

  const addPhoto = async (file: File | undefined) => {
    setPhotoError(null);
    if (!file) return;
    try {
      const b64 = await fileToPhotoB64(file);
      setPhotoB64(b64);
    } catch {
      setPhotoB64(null);
      setPhotoError(t("dn_photo_err"));
    }
  };

  const resetForm = () => {
    setPath("");
    setItemDescription("");
    setCategory("");
    setConditionNote("");
    setQuantity("");
    setAddressStreet("");
    setAddressCity("");
    setAddressZip("");
    setApproachNotes("");
    setPickupTimeWindow("");
    setPhotoB64(null);
    setPhotoError(null);
    setTopError(null);
    setPhase("form");
  };

  const doSend = async () => {
    setSending(true);
    setTopError(null);
    try {
      const res = await fetch(DONATION_API.submitOffer, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          itemDescription: itemDescription.trim(),
          category,
          conditionNote: conditionNote.trim() || undefined,
          quantity: quantity.trim() || undefined,
          contactPhone: phoneInput,
          addressStreet: addressStreet.trim() || undefined,
          addressCity: addressCity.trim() || undefined,
          addressZip: addressZip.trim() || undefined,
          approachNotes: approachNotes.trim() || undefined,
          pickupTimeWindow: pickupTimeWindow.trim() || undefined,
          photoB64: photoB64 || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setAlertIdentity(phoneInput, identity?.name && identity.name !== "Neighbor" ? identity.name : "Neighbor");
        setPhase("done");
      } else {
        setTopError(data?.error ?? t("dn_err"));
      }
    } catch {
      setTopError(t("dn_err"));
    } finally {
      setSending(false);
    }
  };

  /* Done — calm confirmation of what happens next (the state flips in place). */
  if (phase === "done") {
    return (
      <Card className="border-sg-sage/60 bg-sg-sage-wash/40">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sg-sage text-white" aria-hidden>
            <CheckCircleIcon size={28} />
          </span>
          <h2 className="text-h2">{t("dn_offer_done")}</h2>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {t("dn_done_next").replace("{phone}", formatPhone(phoneInput))}
          </p>
          <p className="text-small font-medium text-sg-sage-deep">{t("dn_done_notified")}</p>
          <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
            <Button full onClick={resetForm}>{t("dn_done_another_offer")}</Button>
            <Link to="/" className="block w-full">
              <Button variant="secondary" full>{t("ps_home")}</Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2">{t("dn_offer_title")}</h2>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("dn_offer_sub")}</p>
        </div>

        {topError ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {topError}
          </p>
        ) : null}

        <div role="radiogroup" aria-label={t("dn_path_question")} className="flex flex-col gap-2">
          <p className="text-btn font-medium">{t("dn_path_question")}</p>
          {path === "" ? <p className="text-small text-sg-ink-soft">{t("dn_path_hint")}</p> : null}
          {OFFER_PATHS.map((p) => (
            <RadioCard
              key={p}
              checked={path === p}
              onSelect={() => setPath(p)}
              title={t(p === "porch_drop" ? "dn_path_porch" : p === "scheduled_pickup" ? "dn_path_pickup" : "dn_path_mprcc")}
              sub={t(p === "porch_drop" ? "dn_path_porch_sub" : p === "scheduled_pickup" ? "dn_path_pickup_sub" : "dn_path_mprcc_sub")}
            >
              {p === "mprcc_porch" && path === p ? (
                <span className="mt-1 block rounded-[10px] bg-sg-paper px-3 py-2 text-small text-sg-ink-soft">
                  {MPRCC_PORCH.address} — {MPRCC_PORCH.hours}
                  <span className="mt-0.5 block text-sg-ink">“{MPRCC_PORCH.dropInstruction}”</span>
                </span>
              ) : null}
            </RadioCard>
          ))}
        </div>

        {path === "porch_drop" || path === "scheduled_pickup" ? (
          <fieldset className="flex flex-col gap-4 rounded-[12px] border border-sg-line bg-sg-paper p-3">
            <legend className="sr-only">{t("dn_address")}</legend>
            <TextField
              label={t("dn_address_street")}
              value={addressStreet}
              onChange={(e) => setAddressStreet(e.target.value)}
              placeholder={t("dn_address_street_ph")}
              maxLength={120}
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t("dn_address_city")}
                value={addressCity}
                onChange={(e) => setAddressCity(e.target.value)}
                placeholder={t("dn_address_city_ph")}
                maxLength={60}
              />
              <TextField
                label={t("dn_address_zip")}
                value={addressZip}
                onChange={(e) => setAddressZip(normPhone(e.target.value).slice(0, 10))}
                placeholder={t("dn_address_zip_ph")}
                inputMode="numeric"
                maxLength={10}
              />
            </div>
            {path === "porch_drop" ? (
              <>
                <TextArea
                  label={t("dn_approach")}
                  helper={t("dn_approach_help")}
                  value={approachNotes}
                  onChange={(e) => setApproachNotes(e.target.value)}
                  placeholder={t("dn_approach_ph")}
                  maxLength={300}
                />
                <p className="text-small text-sg-ink-soft">{PORCH_DROP_STAFF_NOTE}</p>

                <div className="flex flex-col gap-1.5">
                  <span className="text-btn font-medium">{t("dn_photo")}</span>
                  <span className="text-small text-sg-ink-soft">{t("dn_photo_help")}</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(e) => void addPhoto(e.target.files?.[0])}
                  />
                  {photoB64 ? (
                    <div className="flex items-start gap-3">
                      <img
                        src={`data:image/jpeg;base64,${photoB64}`}
                        alt={t("dn_photo_preview")}
                        className="h-24 w-24 rounded-[12px] border border-sg-line object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => { setPhotoB64(null); setPhotoError(null); if (fileRef.current) fileRef.current.value = ""; }}
                        className="inline-flex min-h-[44px] items-center gap-1.5 text-btn font-medium text-sg-clay underline underline-offset-2"
                      >
                        <CloseIcon size={16} aria-hidden /> {t("dn_photo_remove")}
                      </button>
                    </div>
                  ) : (
                    <Button variant="secondary" full onClick={() => fileRef.current?.click()}>
                      {t("dn_photo_add")}
                    </Button>
                  )}
                  {photoError ? <p className="text-small text-sg-danger-gentle">{photoError}</p> : null}
                </div>
              </>
            ) : (
              <TextField
                label={t("dn_pickup_window")}
                helper={t("dn_pickup_window_help")}
                value={pickupTimeWindow}
                onChange={(e) => setPickupTimeWindow(e.target.value)}
                placeholder={PICKUP_TIME_PLACEHOLDER}
                maxLength={120}
              />
            )}
          </fieldset>
        ) : null}

        <CategorySelect
          label={t("dn_category")}
          value={category}
          onChange={setCategory}
          phKey="dn_category_ph"
        />

        <TextField
          label={t("dn_item_desc")}
          value={itemDescription}
          onChange={(e) => setItemDescription(e.target.value)}
          placeholder={t("dn_item_desc_ph")}
          maxLength={300}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("dn_condition")}
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value)}
            placeholder={t("dn_condition_ph")}
            maxLength={200}
          />
          <TextField
            label={t("dn_quantity")}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t("dn_quantity_ph")}
            maxLength={60}
          />
        </div>

        <TextField
          label={t("dn_phone")}
          helper={t("dn_phone_help")}
          value={phoneInput}
          onChange={(e) => setPhoneInput(normPhone(e.target.value))}
          placeholder="e.g. 415 555-0142"
          inputMode="tel"
          error={phoneInput.length > 0 && !phoneOk ? t("dn_phone_bad") : undefined}
        />

        <ConsentReceipt
          who={t("dn_who")}
          what={t("dn_what_offer")}
          howLong={t("dn_how")}
          stopLabel={t("dn_stop")}
        />

        <Button
          full
          aria-busy={sending}
          disabled={!canSubmit || sending}
          disabledReason={!canSubmit ? t("dn_offer_need") : undefined}
          onClick={() => void doSend()}
        >
          {sending ? t("dn_sending") : t("dn_submit_offer")}
        </Button>
      </div>
    </Card>
  );
}

/* ── Request form ───────────────────────────────────────────────── */

type RequestPhase = "form" | "done";

export function RequestItemForm({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const [identity] = useState(() => getAlertIdentity());
  const [phase, setPhase] = useState<RequestPhase>("form");

  const [item, setItem] = useState("");
  const [category, setCategory] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [size, setSize] = useState("");
  const [pod, setPod] = useState<PickupOrDelivery | "">("");
  const [phoneInput, setPhoneInput] = useState(identity?.phone ?? "");
  const [sending, setSending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const phoneOk = phoneLooksOk(phoneInput);
  const canSubmit = category !== "" && item.trim() !== "" && pod !== "" && phoneOk;

  const sizePrompt = sizePromptFor(category);

  const resetForm = () => {
    setItem("");
    setCategory("");
    setQuantity("");
    setNotes("");
    setSize("");
    setPod("");
    setTopError(null);
    setPhase("form");
  };

  const doSend = async () => {
    setSending(true);
    setTopError(null);
    try {
      const res = await fetch(DONATION_API.submitRequest, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item: item.trim(),
          category,
          quantity: quantity.trim() || undefined,
          notes: notes.trim() || undefined,
          size: size.trim() || undefined,
          pickupOrDelivery: pod,
          contactPhone: phoneInput,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) {
        setAlertIdentity(phoneInput, identity?.name && identity.name !== "Neighbor" ? identity.name : "Neighbor");
        setPhase("done");
      } else {
        setTopError(data?.error ?? t("dn_err"));
      }
    } catch {
      setTopError(t("dn_err"));
    } finally {
      setSending(false);
    }
  };

  if (phase === "done") {
    return (
      <Card className="border-sg-sage/60 bg-sg-sage-wash/40">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sg-sage text-white" aria-hidden>
            <CheckCircleIcon size={28} />
          </span>
          <h2 className="text-h2">{t("dn_request_done")}</h2>
          <p className="max-w-xs text-body text-sg-ink-soft">
            {t("dn_done_next").replace("{phone}", formatPhone(phoneInput))}
          </p>
          <p className="text-small font-medium text-sg-sage-deep">{t("dn_done_notified")}</p>
          <div className="mt-1 flex w-full max-w-xs flex-col gap-2">
            <Button full onClick={resetForm}>{t("dn_done_another_request")}</Button>
            <Link to="/" className="block w-full">
              <Button variant="secondary" full>{t("ps_home")}</Button>
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-h2">{t("dn_req_title")}</h2>
          <p className="mt-0.5 text-small text-sg-ink-soft">{t("dn_req_sub")}</p>
        </div>

        {topError ? (
          <p className="rounded-[12px] bg-sg-clay-wash px-3 py-2 text-small text-sg-clay" role="alert">
            {topError}
          </p>
        ) : null}

        <CategorySelect
          label={t("dn_category")}
          value={category}
          onChange={setCategory}
          phKey="dn_category_ph"
        />

        <TextField
          label={t("dn_req_item")}
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder={t("dn_req_item_ph")}
          maxLength={200}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={t("dn_quantity")}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={t("dn_quantity_ph")}
            maxLength={60}
          />
          <TextField
            label={t("dn_req_size")}
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder={sizePrompt ?? "—"}
            maxLength={60}
          />
        </div>

        <TextArea
          label={t("dn_req_notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("dn_req_notes_ph")}
          maxLength={500}
        />

        <div role="radiogroup" aria-label={t("dn_req_pod")} className="flex flex-col gap-2">
          <p className="text-btn font-medium">{t("dn_req_pod")}</p>
          {(["pickup", "delivery", "either"] as const).map((p) => (
            <RadioCard
              key={p}
              checked={pod === p}
              onSelect={() => setPod(p)}
              title={t(p === "pickup" ? "dn_pod_pickup" : p === "delivery" ? "dn_pod_delivery" : "dn_pod_either")}
              sub={t(p === "pickup" ? "dn_pod_pickup_sub" : p === "delivery" ? "dn_pod_delivery_sub" : "dn_pod_either_sub")}
            />
          ))}
        </div>

        <TextField
          label={t("dn_phone")}
          helper={t("dn_phone_help")}
          value={phoneInput}
          onChange={(e) => setPhoneInput(normPhone(e.target.value))}
          placeholder="e.g. 415 555-0142"
          inputMode="tel"
          error={phoneInput.length > 0 && !phoneOk ? t("dn_phone_bad") : undefined}
        />

        <ConsentReceipt
          who={t("dn_who")}
          what={t("dn_what_request")}
          howLong={t("dn_how")}
          stopLabel={t("dn_stop")}
        />

        <Button
          full
          aria-busy={sending}
          disabled={!canSubmit || sending}
          disabledReason={!canSubmit ? t("dn_request_need") : undefined}
          onClick={() => void doSend()}
        >
          {sending ? t("dn_sending") : t("dn_submit_request")}
        </Button>
        {compact ? null : <p className="px-1 text-small text-sg-ink-soft">{t("dn_req_caption")}</p>}
      </div>
    </Card>
  );
}