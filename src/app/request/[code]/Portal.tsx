// The customer portal's tabs besides the order form (/request/<code>?tab=…): the studio's printers, the price
// calculator and the token research, each read-only and shaped on the server by src/lib/portal.ts. No hooks, so the
// server renders them and the tests render them the same way. "My orders" lives in the browser (MyOrders.tsx).
import Form from "next/form";
import Icon from "@/app/components/Icon";
import Info from "@/app/components/Info";
import ColorSwatch from "@/app/components/ColorSwatch";
import { pickTab, type Tab } from "@/app/components/Tabs";
import type { PortalMachines, PortalPrice, PortalPrinter, PortalToken } from "@/lib/portal";
import type { GateStatus } from "@/lib/token-research";
import { MATERIALS } from "@/lib/pricing";
import { tLib } from "@/lib/lib-text";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import "../../machines/machines.css";
import "./portal.css";

/** The menu under the header. The order form first: /request/<code> without ?tab opens it. */
export const PORTAL_TABS: Tab[] = [
  { id: "order", label: "New order" },
  { id: "orders", label: "My orders" },
  { id: "machines", label: "Machines" },
  { id: "price", label: "Price calculator" },
  { id: "token", label: "Token research" },
];
export type PortalTab = "order" | "orders" | "machines" | "price" | "token";
/** ?tab= as given; anything else (missing, unknown, repeated) opens the order form. */
export const portalTab = (wanted: string | string[] | undefined): PortalTab => pickTab(PORTAL_TABS, wanted) as PortalTab;

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

// ---------- Machines ----------

function PrinterRow({ p, t }: { p: PortalPrinter; t: T }) {
  return (
    <li className={`card portal-printer${p.online ? "" : " offline"}`}>
      <div className="portal-printer-top">
        <div>
          <h3>{p.name}</h3>
          <p><span className={`live-dot${p.online ? "" : " off"}`} />{t(p.online ? "Online" : "Offline")}</p>
        </div>
        <span className={`mach-pill ${p.state.tone}`}>{p.state.text}</span>
      </div>
      {p.stage?.needsPerson && <p className="portal-stage">{t("Waiting for a person at Kesuni")}</p>}
      {p.progress && (
        <div className={`mach-progress${p.progress.paused ? " paused" : ""}`}>
          <div className="mach-progress-head">
            <b>{p.progress.percent}%</b>
            {p.progress.paused ? <span className="mach-warn">{t("Paused")}</span> : p.stage && !p.stage.needsPerson && <span>{p.stage.text}</span>}
          </div>
          <div className="mach-bar" role="progressbar" aria-valuenow={p.progress.percent} aria-valuemin={0} aria-valuemax={100}
            aria-label={t("{name} progress", { name: p.name })}>
            <span style={{ width: `${p.progress.percent}%` }} />
          </div>
          {/* Offline: the percent is the last known reading, a time left would be stale. */}
          {p.online && !p.progress.paused && (p.progress.remaining !== "—" || p.progress.doneAt) && (
            <div className="portal-eta">
              {p.progress.remaining !== "—" && <span>{t("{time} left", { time: p.progress.remaining })}</span>}
              {p.progress.doneAt && <b>{t("Done around {time} WIB", { time: p.progress.doneAt })}</b>}
            </div>
          )}
        </div>
      )}
      {p.spools.length > 0 && (
        <ul className="portal-spools" aria-label={t("Colours loaded")}>
          {p.spools.map((s) => (
            <li key={s.key} className={s.active ? "on" : ""}>
              <ColorSwatch color={s.color} colors={s.colors} active={s.active} size={20} />
              <span>{s.type}{s.name && <small>{t(s.name)}</small>}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function MachinesTab({ m, t, locale }: { m: PortalMachines; t: T; locale: Locale }) {
  const clock = new Date(m.at).toLocaleTimeString(dateLocale(locale), { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <div className="portal-head">
        <h2>
          {t("Machines")}
          <Info>{t("Kesuni's printers right now, straight from the studio. Read only: nothing here can move a printer. The page updates by itself.")}</Info>
        </h2>
        <span className="muted">{t("Updated {time} WIB", { time: clock })}</span>
      </div>
      {m.bridgeDown && (
        <p className="alert bad portal-alert">{t("The studio connection is offline. Last report {ago}.", { ago: m.lastReport ?? t("never") })}</p>
      )}
      {m.printers.length === 0
        ? <section className="card"><p className="muted portal-empty">{t("No printer has reported yet.")}</p></section>
        : <ul className="portal-printers">{m.printers.map((p) => <PrinterRow key={p.id} p={p} t={t} />)}</ul>}
    </>
  );
}

// ---------- Price calculator ----------

export function PriceTab({ p, action, t }: { p: PortalPrice; action: string; t: T }) {
  const r = p.result;
  return (
    <section className="card">
      <h2>
        {t("Price calculator")}
        <Info>{t("The weight comes from the slicer (Bambu Studio). Upload your STL in New order and Kesuni weighs it.")}</Info>
      </h2>
      <p className="muted portal-rates">
        {MATERIALS.map((m) => <span key={m}><b>{m}</b> {t("{price} per gram", { price: rupiah(p.perGram[m]) })}</span>)}
      </p>
      {/* A GET form back to this page: the server prices it with the order's own functions; no API, works without JS. */}
      <Form action={action} replace scroll={false} prefetch={false} className="form">
        <input type="hidden" name="tab" value="price" />
        <div className="row fields">
          <label style={{ flex: "2 1 150px" }}>{t("Grams per piece")}
            <input name="g" defaultValue={p.input.grams} inputMode="decimal" placeholder="16" maxLength={12} required />
          </label>
          <label style={{ flex: "1 1 90px" }}>{t("Quantity")}
            <input name="q" type="number" min={1} step={1} defaultValue={p.input.quantity} required />
          </label>
          <label style={{ flex: "1 1 110px" }}>{t("Material")}
            <select name="m" defaultValue={p.material}>
              {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        <button className="primary cust-cta">{t("Calculate")}</button>
      </Form>
      {r?.ok && (
        <div className="cust-price portal-total" aria-live="polite">
          <span className="big">{rupiah(r.totalIdr)}</span>
          <span className="muted">≈ {r.usdc} USDC · {t("{price} per piece", { price: rupiah(r.unitPriceIdr) })}</span>
        </div>
      )}
      {r?.ok && r.totalIdr < p.minOrderIdr && (
        <p className="cust-note portal-note">{t("Orders under {min} need Kesuni's approval first, so the price can take longer.", { min: rupiah(p.minOrderIdr) })}</p>
      )}
      {r && !r.ok && <div className="alert bad" role="status">{r.reasons.map((x) => tLib(t, x)).join("; ")}</div>}
      <p className="cust-note portal-note">{t("An estimate. The final price comes on your order page.")}</p>
    </section>
  );
}

// ---------- Token research ----------

const TONE: Record<GateStatus, string> = { PASS: "ok", "NOT YET": "warn", BLOCKED: "bad", UNKNOWN: "" };

export function TokenTab({ k, t }: { k: PortalToken; t: T }) {
  return (
    <section className="card">
      <h2>
        {t("Token research")}
        <span className={`badge ${k.overall === "ISSUANCE BLOCKED" ? "bad" : "warn"}`}>{t(k.overall)}</span>
      </h2>
      <p className="portal-research">
        <Icon name="flask" size={16} />
        <span>{t("Research only. No token exists and nothing is sold.")}</span>
        <Info>{t("Open3DKesuni works without a token. A token would never be offered in Indonesia. These are the checks Kesuni wants passed before even a legal review.")}</Info>
      </p>
      <p className="muted portal-passed">{t("{n} of {total} checks passed", { n: k.passed, total: k.total })}</p>
      {/* Short on a phone: number, title and status; the one-line reason behind each ⓘ. */}
      <ol className="portal-gates">
        {k.gates.map((g) => (
          <li key={g.id}>
            <span className="portal-gate-n">{g.n}</span>
            <b>{g.title} <Info>{g.line}</Info></b>
            <span className={`badge ${TONE[g.status]}`}>{t(g.status)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
