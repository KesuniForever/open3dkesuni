import Link from "next/link";
import { listOpenTasks, listOrders, listPrinters } from "@/lib/store";
import { ago, isOnline, isPrinterTask, lastBridgeReport, ONLINE_MS } from "@/lib/machines";
import type { OperatorTask, Printer } from "@/lib/types";
import type { T } from "@/i18n/core";
import { getT } from "@/i18n/server";
import PageHead from "../components/PageHead";
import Tabs, { pickTab, type Tab } from "../components/Tabs";
import Callout from "../components/Callout";
import Icon, { type IconName } from "../components/Icon";
import MachinesBoard, { type OrderInfo } from "./MachinesBoard";
import "./machines.css";

export const dynamic = "force-dynamic";

const clock = () => Date.now();

const TASK_TITLE: Partial<Record<OperatorTask["kind"], string>> = {
  check_printer: "Check printer",
  change_filament: "Change filament",
};

/** My machines: the studio's Bambu Lab printers, read live over the LAN by the printer bridge. */
export default async function MachinesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getT();
  const printers = listPrinters();
  const tasks = listOpenTasks().filter(isPrinterTask);
  const orders: Record<string, OrderInfo> = Object.fromEntries(listOrders().map((o) => [o.id, { label: o.label, status: o.status }]));
  const now = clock();
  const tabs: Tab[] = [
    { id: "printers", label: t("Printers"), count: printers.length },
    { id: "connection", label: t("Connection") },
  ];
  const tab = pickTab(tabs, (await searchParams).tab);

  return (
    <main className="wrap">
      <PageHead eyebrow={t("Machine registry")} title={t("Know your machines.")} sub={t("Live status from the studio's printers.")}
        actions={<span className="mach-tag"><Icon name="shield" size={15} />{t("Read-only, no remote control")}</span>} />
      <Tabs tabs={tabs} active={tab} basePath="/machines" />

      {tab === "printers" ? (
        <>
          <MachinesBoard initial={printers} serverNow={now} orders={orders} printerTasks={tasks.length} />
          {tasks.length > 0 && <PrinterTasks tasks={tasks} printers={printers} orders={orders} t={t} />}
        </>
      ) : (
        <Connection printers={printers} now={now} t={t} />
      )}
    </main>
  );
}

function PrinterTasks({ tasks, printers, orders, t }: { tasks: OperatorTask[]; printers: Printer[]; orders: Record<string, OrderInfo>; t: T }) {
  const name = (id?: string) => printers.find((p) => p.id === id)?.name;
  return (
    <section className="card attention-panel mach-tasks">
      <h2>{t("Open printer tasks")}</h2>
      <ul className="attention">
        {tasks.map((task) => {
          const title = TASK_TITLE[task.kind];
          return (
            <li key={task.id}>
              <Link href={`/orders/${task.orderId}`} className="attention-item">
                <span className="attention-icon amber"><Icon name="wrench" /></span>
                <span className="attention-text">
                  <b>{title && t(title)}</b>{name(task.printerId) && ` · ${name(task.printerId)}`}
                  <span className="attention-sub">
                    {task.text}
                    {orders[task.orderId]?.label === "simulated" && <span className="badge simulated">{t("simulated")}</span>}
                  </span>
                </span>
                <Icon name="chevron" size={16} className="attention-go" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Cap = { icon: IconName; title: string; on: boolean; yes?: string; no?: string; note: string };

function Connection({ printers, now, t }: { printers: Printer[]; now: number; t: T }) {
  const last = lastBridgeReport(printers);
  const bridgeUp = last !== null && now - Date.parse(last) <= ONLINE_MS;
  // The LAN bridge is the one capability that is expected to be on, so "off" is a red "Down", not a plain "No".
  const caps: Cap[] = [
    { icon: "network", title: "LAN bridge", on: bridgeUp, yes: "Running", no: "Down",
      note: last ? t("Last report {ago}.", { ago: ago(last, now, t) }) : t("No report yet.") },
    { icon: "pulse", title: "Live telemetry", on: true, yes: "Yes", note: t("State, progress, layer, temperatures, error codes.") },
    { icon: "box", title: "Bed check", on: false, note: t("Printers cannot see the bed. A person confirms it is empty.") },
    { icon: "play", title: "Camera", on: false, note: t("Not connected.") },
    { icon: "shield", title: "Remote control", on: false, note: t("By design. The app never starts, stops or heats a printer.") },
    { icon: "chain", title: "Cloud", on: false, note: t("No Bambu cloud. The bridge reads the printers on the studio network.") },
  ];

  return (
    <>
      <Callout icon="shield" title={t("Read-only by design")}>
        {t("The app reads printer status. It never sends print, move, heat or stop commands.")}
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
          </ul>
        </details>
      </section>
    </>
  );
}
