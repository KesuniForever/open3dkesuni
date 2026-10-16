import { listOpenTasks, listOrders, listPrinters } from "@/lib/store";
import { ago, isOnline, isPrinterTask, lastBridgeReport, ONLINE_MS } from "@/lib/machines";
import { cameraFrame } from "@/lib/printer/jobs";
import { safePlan } from "@/lib/printer/dispatch";
import type { Printer } from "@/lib/types";
import type { T } from "@/i18n/core";
import { getLocale, getT } from "@/i18n/server";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Callout from "../components/Callout";
import Icon, { type IconName } from "../components/Icon";
import MachinesBoard, { PrinterTasks, type OrderInfo } from "./MachinesBoard";
import { issueTexts } from "./issue-texts";
import "./machines.css";

export const dynamic = "force-dynamic";

const clock = () => Date.now();
/** The camera counts as working when the bridge sent a frame this recently (a frame held from long ago proves nothing). */
const FRAME_FRESH_MS = 5 * 60_000;

/** My machines: the studio's Bambu Lab printers, read live over the LAN by the printer bridge, controlled by people. */
export default async function MachinesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const printers = listPrinters();
  const tasks = listOpenTasks().filter(isPrinterTask);
  const orders: Record<string, OrderInfo> = Object.fromEntries(listOrders().map((o) => [o.id, { label: o.label, status: o.status }]));
  const now = clock();
  const texts = issueTexts(printers, await getLocale());
  const tabs: Tab[] = [
    { id: "printers", label: t("Printers"), count: printers.length },
    { id: "connection", label: t("Connection") },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);

  return (
    <main className="wrap">
      <PageHead eyebrow={t("Machine registry")} title={t("Know your machines.")} sub={t("Live status from the studio's printers.")}
        actions={<span className="mach-tag"><Icon name="shield" size={15} />{t("Controls for people only")}</span>} />
      <Tabs tabs={tabs} active={tab} basePath="/machines" />

      {tab === "printers" ? (
        <>
          <MachinesBoard initial={printers} initialPlan={safePlan(now)} serverNow={now} orders={orders} tasks={tasks} issueTexts={texts} />
          {tasks.length > 0 && <PrinterTasks tasks={tasks} printers={printers} orders={orders} texts={texts} />}
        </>
      ) : (
        <Connection printers={printers} now={now} t={t} />
      )}
    </main>
  );
}

type Cap = { icon: IconName; title: string; on: boolean; yes?: string; no?: string; note: string };

function Connection({ printers, now, t }: { printers: Printer[]; now: number; t: T }) {
  const last = lastBridgeReport(printers);
  const bridgeUp = last !== null && now - Date.parse(last) <= ONLINE_MS;
  const frames = printers.some((p) => {
    const f = cameraFrame(p.id);
    return Boolean(f && now - Date.parse(f.at) <= FRAME_FRESH_MS);
  });
  // The LAN bridge is the one capability that is expected to be on, so "off" is a red "Down", not a plain "No".
  const caps: Cap[] = [
    { icon: "network", title: "LAN bridge", on: bridgeUp, yes: "Running", no: "Down",
      note: last ? t("Last report {ago}.", { ago: ago(last, now, t) }) : t("No report yet.") },
    { icon: "pulse", title: "Live telemetry", on: true, yes: "Yes", note: t("Stage, progress, temperatures, fans, AMS spools, errors.") },
    { icon: "box", title: "Bed check", on: false, note: t("Printers cannot see the bed. A person confirms it is empty.") },
    { icon: "play", title: "Camera", on: frames, note: frames ? t("One frame at a time, through the LAN bridge.") : t("No frame in the last 5 min.") },
    { icon: "shield", title: "Remote control", on: true, yes: "People only",
      note: t("Each control with a person's name. Agent prints (code, when on) start only after a person confirmed the bed empty. Never the Chief; never heat, move or G-code.") },
    { icon: "chain", title: "Cloud", on: false, note: t("No Bambu cloud. The bridge reads the printers on the studio network.") },
  ];

  return (
    <>
      <Callout icon="shield" title={t("People control, the Chief only reads")}>
        {t("A person pauses or stops a print with their name. A print starts by a person, or by code after a person confirmed the bed empty when agent prints are on. The app never moves an axis, heats or sends G-code.")}
      </Callout>

      <section className="card mach-card-flush">
        <h2>{t("What is actually connected?")}</h2>
        <div className="mach-caps" style={{ marginTop: 14, borderTop: "1px solid var(--border-soft)" }}>
          {caps.map((c) => (
            <div key={c.title} className={`mach-cap${c.on ? "" : " no"}`}>
              <span className="mach-cap-head">
                <Icon name={c.icon} size={20} />
                <span className={`badge ${c.on ? "ok" : c.no ? "bad" : ""}`}>
                  {t(c.on ? c.yes ?? "Yes" : c.no ?? "No")}
                </span>
              </span>
              <strong>{t(c.title)}</strong>
              <small>{c.note}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{t("Reports per printer")}</h2>
        {printers.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t("No printer has reported yet.")}</p> : (
          <div className="table-wrap">
            <table className="mach-table">
              <thead><tr><th>{t("Printer")}</th><th>{t("Status")}</th><th>{t("Last report")}</th><th>{t("State")}</th></tr></thead>
              <tbody>
                {printers.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b> <span className="muted mono mach-pid">{p.id}</span></td>
                    <td>{isOnline(p, now) ? <span className="badge ok">{t("online")}</span> : <span className="badge bad">{t("offline")}</span>}</td>
                    <td>{ago(p.lastSeen, now, t)}</td>
                    <td className="mono">{p.snapshot?.state ?? t("none")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="fold" style={{ marginTop: 14 }}>
          <summary>{t("How the bridge works")}</summary>
          <ul className="log" style={{ margin: 0 }}>
            <li><code>node scripts/printer-bridge.mjs</code> {t("runs on a computer on the studio network.")}</li>
            <li>{t("It reads each printer's status over MQTT (TLS, port 8883) and sends it here when the state or progress changes, and every 30 s.")}</li>
            <li>{t("Printer events become tasks for a person: change filament, collect the part, check a failed print.")}</li>
            <li>{t("It takes a person's controls and print jobs from this app and checks them again before it sends them. A control not picked up in 60 s expires; a print in 5 min.")}</li>
            <li>{t("Controls from another device need the operator password; only this computer is trusted without one.")}</li>
          </ul>
        </details>
      </section>
    </>
  );
}
