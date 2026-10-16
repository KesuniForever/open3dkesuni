// The body of the public Live studio page (/live): what the printers, the agent and the Arc escrow are doing now.
// A menu under the header: Overview (opens first: the summary), Printers, Agent, Money on Arc. Read-only: no button,
// no form, no link into the operator pages (only to this page's own tabs, Bambu's guides and the Arc explorer).
// Renders only the allow-listed view from src/lib/live.ts. No hooks, so the server renders it and the tests render it the same way.
import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "../components/Icon";
import Info from "../components/Info";
import ColorSwatch from "../components/ColorSwatch";
import SkillChip from "../components/SkillChip";
import { TabNav, pickTab, type Tab } from "../components/Tabs";
import LineMore from "../chief/LineMore";
import { Lock } from "../chief/marks";
import type {
  LiveAgentItem, LiveMoneyPart, LiveOrder, LivePrinter, LiveRunning, LiveTransfer, LiveTxKind, LiveView, LiveVolume,
} from "@/lib/live";
import { dateLocale, type Locale, type T } from "@/i18n/core";
import "../machines/machines.css";
import "../chief/chief.css";
import "./live.css";

const TX_KIND: Record<LiveTxKind, string> = { deposit: "Deposit", release: "Release", refund: "Refund", topup: "Demo top-up" };
const FEED_ICON: Record<string, { icon: IconName; tone: string }> = {
  claude: { icon: "bot", tone: "green" },
  rules: { icon: "gauge", tone: "blue" },
  heartbeat: { icon: "pulse", tone: "blue" },
  action: { icon: "wrench", tone: "" },
  person: { icon: "printer", tone: "" },
};
/** Who did the work: Claude, the rule-based planner, or code (the heartbeat, tasks, Arc checks). A person's row says so in its title. */
const DONE_BY: Record<string, string> = { claude: "Claude", rules: "Rules", heartbeat: "Code", action: "Code" };

/** Order id and its label. Not a link: the order pages are for the studio. */
function OrderTag({ o, t }: { o: LiveOrder | null; t: T }) {
  if (!o) return <span className="live-order">{t("Studio")}</span>;
  return (
    <span className="live-order">
      <span className="mono">{o.id}</span>
      <span className={`badge ${o.label === "removed" ? "" : o.label}`}>{t(o.label === "removed" ? "order removed" : o.label)}</span>
    </span>
  );
}

function Fault({ f, t }: { f: LivePrinter["faults"][number]; t: T }) {
  return (
    <div className={`mach-fault ${f.tone}`}>
      <div className="mach-fault-head">
        <Icon name="wrench" size={16} />
        <b>{f.tone === "bad" ? t("Printer error") : t("Printer warning")}</b>
        {f.level && <span className="mach-fault-level">{t(f.level)}</span>}
      </div>
      <p>{f.text ?? t("Unknown printer message")}</p>
      <div className="mach-fault-foot">
        <code>{f.code}</code>
        {f.url && <a href={f.url} target="_blank" rel="noreferrer">{t("Open guide")} <Icon name="arrow" size={13} /></a>}
      </div>
    </div>
  );
}

const target = (n: number | null, t: T) => (n ? <small className="mach-target">{t("target {n} °C", { n })}</small> : null);

function PrinterCard({ p, t }: { p: LivePrinter; t: T }) {
  const slots = p.ams?.slots ?? [];
  return (
    <article className={`mach-card live-printer${p.online ? "" : " offline"}${p.faults.some((f) => f.tone === "bad") ? " fault" : ""}`}>
      <div className="mach-top">
        <span className="mach-symbol"><Icon name="printer" size={28} /></span>
        <span className={`mach-pill ${p.pill.tone}`}>{p.pill.text}</span>
      </div>
      <div className="mach-id">
        <span className="mach-eyebrow">Bambu Lab A1 Combo</span>
        <h3>{p.name}</h3>
        <p>
          <span className={`live-dot${p.online ? "" : " off"}`} />
          <b>{t(p.online ? "Online" : "Offline")}</b> · {t("Last report {ago}", { ago: p.lastReport })}
        </p>
      </div>

      {p.faults.length > 0 && <div className="mach-faults">{p.faults.map((f) => <Fault key={f.code} f={f} t={t} />)}</div>}

      {p.stage && (
        <p className={`mach-stage${p.stage.needsPerson ? " alert" : ""}`}>
          <Icon name={p.stage.needsPerson ? "wrench" : "pulse"} size={15} />
          <span><small>{p.stage.needsPerson ? t("Needs a person") : t("Doing now")}</small>{p.stage.text}</span>
        </p>
      )}

      {p.progress && (
        <div className={`mach-progress${p.progress.paused ? " paused" : ""}`}>
          <div className="mach-progress-head">
            <b>{p.progress.percent}%</b>
            {!p.online ? <span>{t("Last known reading")}</span> : p.progress.paused ? <span className="mach-warn">{t("Paused")}</span> : null}
          </div>
          <div className="mach-bar" role="progressbar" aria-valuenow={p.progress.percent} aria-valuemin={0} aria-valuemax={100}
            aria-label={t("{name} progress", { name: p.name })}>
            <span style={{ width: `${p.progress.percent}%` }} />
          </div>
        </div>
      )}

      <div className="mach-sensors">
        <div><strong>{p.nozzle}</strong><small>{t("Nozzle")}</small>{target(p.nozzleTarget, t)}</div>
        <div><strong>{p.bed}</strong><small>{t("Bed")}</small>{target(p.bedTarget, t)}</div>
        <div><strong>{p.layer}</strong><small>{t("Layer")}</small></div>
        <div><strong>{p.remaining}</strong><small>{t("Remaining")}</small></div>
      </div>

      {(slots.length > 0 || p.external) && (
        <div className="mach-ams">
          <div className="mach-ams-head"><span>{p.ams?.lite ? "AMS lite" : "AMS"}</span></div>
          <ul className="mach-slots">
            {slots.map((x) => {
              const colour = x.name ? t(x.name) : "";
              const title = x.empty ? t("Slot {n}: empty", { n: x.slot })
                : [t("Slot {n}", { n: x.slot }), x.type, colour, x.active ? t("in use") : ""].filter(Boolean).join(" · ");
              return (
                <li key={x.slot} className={x.active ? "on" : x.empty ? "empty" : ""} title={title}>
                  <ColorSwatch color={x.color} colors={x.colors} active={x.active} size={26} />
                  <b>{x.slot}</b>
                  <span>{x.empty ? t("Empty") : x.type}</span>
                  <small>{colour}</small>
                </li>
              );
            })}
            {p.external && (
              <li className={p.external.active ? "on" : ""} title={[t("External spool"), p.external.type, p.external.name && t(p.external.name)].filter(Boolean).join(" · ")}>
                <ColorSwatch color={p.external.color} active={p.external.active} size={26} />
                <b>{t("Ext")}</b>
                <span>{p.external.type}</span>
                <small>{p.external.name ? t(p.external.name) : ""}</small>
              </li>
            )}
          </ul>
        </div>
      )}

      <dl className="kv-rows">
        {/* A finished part on the bed names its order there: no "Order: None" above it. */}
        {(p.order || !p.bedHolds) && (
          <div><dt>{t("Order")}</dt><dd>{p.order ? <OrderTag o={p.order} t={t} /> : <span className="muted">{t("None")}</span>}</dd></div>
        )}
        <div>
          <dt>{t("Bed")}</dt>
          <dd>
            {!p.bedHolds ? <span className="muted">{t("Empty")}</span> : (
              <span className="live-bed">
                <span className="mach-warn">{t("Holds a part to collect")}</span>
                {p.bedHolds.order && <OrderTag o={p.bedHolds.order} t={t} />}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function AgentRow({ a, t }: { a: LiveAgentItem; t: T }) {
  const kind = a.kind === "run" ? (a.mode ?? "rules") : a.kind;
  const look = FEED_ICON[kind];
  return (
    <li className="chief-item">
      <span className={`attention-icon ${a.refused ? "amber" : look.tone}`}><Icon name={look.icon} /></span>
      <div className="chief-body">
        <div className="chief-top">
          <b>{a.title}</b>
          {a.repeats > 1 && <span className="badge">×{a.repeats}</span>}
          <time className="chief-when" dateTime={a.at}>{a.when} WIB</time>
        </div>
        {a.line && <LineMore className="chief-line" line={a.line} />}
        <div className="chief-meta">
          <SkillChip skill={a.skill} />
          {DONE_BY[kind] && <span className={`badge live-by ${kind}`}>{t(DONE_BY[kind])}</span>}
          <OrderTag o={a.order} t={t} />
          {a.refused > 0 && <span className="badge warn">{t("Refused by policy")}</span>}
          {a.asked && <span className="badge testnet live-asked"><Lock size={11} />{t("Asked a person")}</span>}
        </div>
      </div>
    </li>
  );
}

function checkText(x: LiveTransfer): string {
  if (x.state === "failed") return "failed";
  if (x.state === "pending") return "in progress";
  return x.check === "verified" ? "Verified on Arc" : x.check === "mismatch" ? "mismatch" : "not checked yet";
}

function Check({ x, t }: { x: LiveTransfer; t: T }) {
  const tone = x.state === "failed" || x.check === "mismatch" ? "bad" : x.check === "verified" && x.state === "complete" ? "ok" : "";
  return <span className={`badge ${tone}`}>{t(checkText(x))}</span>;
}

function TransferRow({ x, t }: { x: LiveTransfer; t: T }) {
  return (
    <li className="live-tx">
      <div className="live-tx-top">
        <b>{t(TX_KIND[x.kind])}</b>
        <span className="live-amt">{x.amount} {t(x.testnet ? "test USDC" : "USDC")}</span>
      </div>
      <div className="live-tx-meta">
        <time dateTime={x.at}>{x.when} WIB</time>
        <OrderTag o={x.order} t={t} />
        <Check x={x} t={t} />
        {x.explorerUrl && (
          <a href={x.explorerUrl} target="_blank" rel="noreferrer" title={t("View on the Arc explorer")}>
            <span className="mono">{x.hash}</span> <Icon name="arrow" size={12} />
          </a>
        )}
      </div>
    </li>
  );
}

// ---------- the overview (the tab /live opens on) ----------

/** "0.3 test USDC", "1 USDC + 0.3 test USDC"; real and test money are never added together. */
function volumeText(x: LiveVolume, testnet: boolean, t: T): string {
  const parts = [x.usdc !== "0" ? `${x.usdc} USDC` : "", x.testUsdc !== "0" ? `${x.testUsdc} ${t("test USDC")}` : ""].filter(Boolean);
  return parts.length ? parts.join(" + ") : `0 ${t(testnet ? "test USDC" : "USDC")}`;
}

/** A card's title and the link to the tab with the details. The link lands on the tabs row (#live-tabs). */
function CardHead({ icon, title, info, to, t }: { icon: IconName; title: string; info: ReactNode; to: LiveTab; t: T }) {
  const label = LIVE_TABS.find((x) => x.id === to)!.label;
  return (
    <div className="live-ov-head">
      <h2><Icon name={icon} size={19} />{title}<Info>{info}</Info></h2>
      <Link href={`/live?tab=${to}#live-tabs`} className="live-ov-more">{t(label)}<Icon name="arrow" size={13} /></Link>
    </div>
  );
}

function RunRow({ r, t }: { r: LiveRunning; t: T }) {
  return (
    <li className={`mach-progress live-run-row${r.paused ? " paused" : ""}`}>
      <div className="live-run-top">
        <b>{r.name}</b>
        {r.order && <OrderTag o={r.order} t={t} />}
      </div>
      <div className="mach-progress-head">
        <b>{r.percent}%</b>
        {r.stage && <span className={r.needsPerson ? "mach-warn" : ""}>{r.stage}</span>}
      </div>
      <div className="mach-bar" role="progressbar" aria-valuenow={r.percent} aria-valuemin={0} aria-valuemax={100}
        aria-label={t("{name} progress", { name: r.name })}>
        <span style={{ width: `${r.percent}%` }} />
      </div>
      <div className="live-run-meta">
        {r.paused ? <span className="mach-warn">{t("Paused")}</span> : !r.online ? <span>{t("Last known reading")}</span> : null}
        {r.remaining !== "—" && <span>{t("{time} left", { time: r.remaining })}</span>}
        {r.doneAt && <b>{t("Done around {time} WIB", { time: r.doneAt })}</b>}
      </div>
    </li>
  );
}

function Overview({ v, t }: { v: LiveView; t: T }) {
  const { printers: p, orders: o, money: m, agent: a } = v.overview;
  const ap = v.agentPrints;
  const part = (x: LiveMoneyPart) => [
    t(x.transfers === 1 ? "{n} transfer" : "{n} transfers", { n: x.transfers }),
    volumeText(x.volume, v.network.isTestnet, t),
    ...(x.transfers ? [t("{n} verified", { n: x.verified })] : []),
  ].join(" · ");
  return (
    <div className="live-ov">
      <section className="card live-ov-card live-ov-run">
        <CardHead icon="printer" title={t("Running now")} to="printers" t={t}
          info={t("Printers with a print running or paused. Stage words and time left come from the printer; the finish time is an estimate.")} />
        <dl className="live-glance live-ov-stats four">
          <div><dt>{t("Printers online")}</dt><dd>{p.online}<small> / {p.total}</small></dd></div>
          <div>
            <dt>{t("Printing")}</dt>
            <dd>{p.printing}{p.paused > 0 && <span className="live-glance-sub">{t("{n} paused", { n: p.paused })}</span>}</dd>
          </div>
          <div><dt>{t("Ready for a job")}</dt><dd>{p.ready}</dd></div>
          <div><dt>{t("Parts to collect")}</dt><dd>{p.toCollect.length}</dd></div>
        </dl>
        {p.running.length === 0
          ? <p className="live-ov-none"><Icon name="pulse" size={16} />{t("No printer is printing right now.")}</p>
          : <ul className="live-run">{p.running.map((r) => <RunRow key={r.id} r={r} t={t} />)}</ul>}
        {p.toCollect.length > 0 && (
          <ul className="live-collect">
            {p.toCollect.map((b) => (
              <li key={b.name}>
                <b>{b.name}</b><span className="mach-warn">{t("Holds a part to collect")}</span>{b.order && <OrderTag o={b.order} t={t} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="live-ov-grid">
        <section className="card live-ov-card">
          <CardHead icon="orders" title={t("Orders")} to="money" t={t}
            info={t("Every order on this site, by id only: no customer names or product titles. In progress: not paid out or rejected yet.")} />
          <dl className="live-glance live-ov-stats three">
            <div><dt>{t("All")}</dt><dd>{o.total}</dd></div>
            <div><dt>{t("In progress")}</dt><dd>{o.inProgress}</dd></div>
            <div><dt>{t("Finished")}</dt><dd>{o.finished}</dd></div>
          </dl>
          <p className="live-ov-split">
            <span><span className="badge real">{t("real")}</span><b>{o.real}</b></span>
            <span><span className="badge simulated">{t("simulated")}</span><b>{o.simulated}</b></span>
            <Info>{t("Simulated orders are the team's own tests. They are never counted as real business.")}</Info>
          </p>
          <dl className="kv-rows live-ov-rows">
            <div>
              <dt>{t("Next deadline")}</dt>
              <dd>
                {!o.next ? <span className="muted">{t("None")}</span> : (
                  <span className="live-due">
                    <OrderTag o={o.next.order} t={t} />
                    <span className={o.next.late ? "mach-warn" : ""}>{o.next.due}</span>
                    <small>{o.next.day}</small>
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card money live-money live-ov-card">
          <CardHead icon="wallet" title={t("Transactions on Arc")} to="money" t={t}
            info={<>
              {t("Completed escrow transfers on Arc. Only the transfers of real orders count; the team's tests are shown apart.")}
              {v.network.isTestnet && <>{" "}{t("All money here is test USDC on Arc Testnet.")}</>}
            </>} />
          <dl className="live-usage">
            <div><dt>{t("Arc transfers")}</dt><dd>{m.transfers}</dd></div>
            <div><dt>{t("Verified on Arc")}</dt><dd>{m.verified}<small> / {m.transfers}</small></dd></div>
            <div className="wide"><dt>{t("Volume")}</dt><dd className="live-usage-text">{volumeText(m.volume, v.network.isTestnet, t)}</dd></div>
          </dl>
          <dl className="kv-rows live-ov-rows">
            <div><dt>{t("Real orders")}</dt><dd>{part(m.real)}</dd></div>
            <div><dt>{t("Tests, not counted")}</dt><dd>{part(m.test)}</dd></div>
          </dl>
        </section>

        <section className="card live-ov-card">
          <CardHead icon="bot" title={t("Agent today")} to="agent" t={t}
            info={t("The AI agent watches the orders and printers by itself and asks a person when it is not sure. Counted from midnight WIB.")} />
          <dl className="live-glance live-ov-stats">
            <div><dt>{t("Decisions today")}</dt><dd>{a.decisions}</dd></div>
            <div><dt>{t("Handed to a person")}</dt><dd>{a.handedToPerson}<span className="live-glance-sub">{t("today")}</span></dd></div>
            <div><dt>{t("Agent prints")}</dt><dd>{ap.started}<span className="live-glance-sub">{t(ap.on ? "allowed" : "not allowed")}</span></dd></div>
          </dl>
          <p className="live-ov-note muted">
            {t(a.claudeRuns === 1 ? "Claude ran {n} time today." : "Claude ran {n} times today.", { n: a.claudeRuns })}
            {ap.started === 0 && <>{" "}{t("No agent print yet: people started every print so far.")}</>}
          </p>
        </section>
      </div>
    </div>
  );
}

// ---------- the page ----------

/** The menu under the header. Overview first: /live without ?tab opens it. */
export const LIVE_TABS: Tab[] = [
  { id: "overview", label: "Overview" },
  { id: "printers", label: "Printers" },
  { id: "agent", label: "Agent" },
  { id: "money", label: "Money on Arc" },
];
export type LiveTab = "overview" | "printers" | "agent" | "money";
/** ?tab= as given; anything else (missing, unknown, repeated) opens the Overview. */
export const liveTab = (wanted: string | string[] | undefined): LiveTab => pickTab(LIVE_TABS, wanted) as LiveTab;

/** The whole page below the top bar. `tab`: the open tab. `seconds`: how often the page refreshes itself. */
export default function LiveStudio({ v, t, locale, seconds, tab = "overview" }: { v: LiveView; t: T; locale: Locale; seconds: number; tab?: LiveTab }) {
  const online = v.printers.filter((p) => p.online).length;
  // No printer online: the studio's bridge (or its network) is down. Then the page does not claim to be live.
  const bridgeDown = v.printers.length > 0 && online === 0;
  const clock = new Date(v.at).toLocaleTimeString(dateLocale(locale), { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const u = v.usage;
  const lastTx = v.transfers.find((x) => x.state === "complete" && x.explorerUrl);
  const ap = v.agentPrints;

  return (
    <>
      <section className="cust-hero live-hero">
        <div className="live-hero-text">
          <div className="live-badges">
            {bridgeDown
              ? <span className="badge warn"><span className="live-dot off" />{t("Bridge offline · last report {ago}", { ago: v.lastReport ?? t("never") })}</span>
              : <span className="badge ok"><span className="live-dot" />Live</span>}
            <span className="badge"><Icon name="shield" size={12} />{t("Read only")}</span>
            <span className="badge testnet">{v.network.name} · {t(v.network.isTestnet ? "test USDC" : "USDC")}</span>
          </div>
          <h1>Open3DKesuni</h1>
          <p className="live-lead">{t("A real 3D-print studio in Padang, Indonesia. An AI agent runs the order desk; people do the hands-on work.")}</p>
          <p className="live-safe"><Icon name="shield" size={16} />{t("Nothing on this page can move a printer or money.")}</p>
          {lastTx && (
            <p className="live-arc">
              <Icon name="wallet" size={15} />
              <span>{t("Last Arc transfer")}:</span>
              <a href={lastTx.explorerUrl!} target="_blank" rel="noreferrer" title={t("View on the Arc explorer")}>
                {t(TX_KIND[lastTx.kind])} {lastTx.amount} {t(lastTx.testnet ? "test USDC" : "USDC")} · {t(checkText(lastTx))} <Icon name="arrow" size={12} />
              </a>
            </p>
          )}
        </div>
      </section>

      <div className="live-tabs" id="live-tabs">
        <TabNav tabs={LIVE_TABS} active={tab} basePath="/live" t={t} />
        <span className={`mach-live${bridgeDown ? " off" : ""}`}><span className={`live-dot${bridgeDown ? " off" : ""}`} />{t("Updated {time} WIB", { time: clock })}</span>
      </div>

      {tab === "overview" && <Overview v={v} t={t} />}

      {tab === "printers" && (
        <>
          <div className="live-head">
            <h2>
              <Icon name="printer" size={20} />{t("Printers")}
              <Info>{t("Three Bambu Lab A1 Combo printers in the studio. A bridge on the studio network reads them and reports here. Stage and fault texts are Bambu's own.")}</Info>
            </h2>
          </div>
          {v.printers.length === 0 ? (
            <section className="card"><p className="muted" style={{ margin: 0 }}>{t("No printer has reported yet.")}</p></section>
          ) : (
            <div className="mach-grid">{v.printers.map((p) => <PrinterCard key={p.id} p={p} t={t} />)}</div>
          )}
        </>
      )}

      {tab === "agent" && (
        <section className="card live-agent">
          <h2>
            <Icon name="bot" size={19} />{t("The agent at work")}
            <Info>{t("The Chief is one Claude agent with five skills. A heartbeat checks open orders and printers every few minutes and wakes it when a decision is needed. Rules in code limit what it may do; agent prints are started by code, never by Claude. Names and files are hidden here.")}</Info>
          </h2>
          <div className="live-switch">
            <span className={`ap-state${ap.on ? " on" : ""}`}><span className="ap-dot" />{t(ap.on ? "Agent prints on" : "Agent prints off")}</span>
            <span className="muted">{t("Code starts them, never Claude, and only after a person confirms the bed is empty. So far: {n}.", { n: ap.started })}</span>
          </div>
          {v.agent.length === 0
            ? <p className="muted" style={{ margin: 0 }}>{t("No agent activity yet.")}</p>
            : <ul className="chief-feed">{v.agent.map((a) => <AgentRow key={a.id} a={a} t={t} />)}</ul>}
        </section>
      )}

      {tab === "money" && (
        <section className="card money live-money live-money-tab">
          <h2>
            <Icon name="wallet" size={19} />{t("Money on Arc")}
            <Info>
              {t("A customer pays into a USDC escrow on Arc (Circle wallets). It goes to Kesuni only after the customer accepts the print, or back after a rejection. Each transfer links to the Arc explorer.")}
              {" "}{t("“Verified on Arc” means this site read the transaction back from Arc itself: sender, recipient and amount match.")}
              {v.network.isTestnet && <>{" "}{t("All money here is test USDC on Arc Testnet.")}</>}
            </Info>
          </h2>
          <dl className="live-usage">
            <div><dt>{t("Real customers")}</dt><dd>{u.realCustomers}</dd></div>
            <div><dt>{t("Real orders")}</dt><dd>{u.realOrders}</dd></div>
            <div><dt>{t("Transfers on real orders")}</dt><dd>{u.arcTransfers}</dd></div>
            <div><dt>{t("Of those, verified")}</dt><dd>{u.arcTransfers ? <>{u.verified}<small> / {u.arcTransfers}</small></> : "—"}</dd></div>
          </dl>
          <p className="live-excluded muted">
            {t("Not counted")}: {t(u.simulatedOrders === 1 ? "{n} simulated order" : "{n} simulated orders", { n: u.simulatedOrders })}
            {" · "}{t(u.testTransfers === 1 ? "{n} test transfer" : "{n} test transfers", { n: u.testTransfers })}
            {" "}<Info>{t(u.rule)}</Info>
          </p>
          <h3 className="live-sub">{t("Latest transfers")}</h3>
          {v.network.isTestnet && v.transfers.some((x) => x.order.label !== "real") && (
            <p className="live-note">{t("Test transfers are real Arc Testnet transactions too, but they are not counted above.")}</p>
          )}
          {v.transfers.length === 0
            ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("No Arc transfers yet.")}</p>
            : <ul className="live-txs">{v.transfers.map((x) => <TransferRow key={x.id} x={x} t={t} />)}</ul>}
        </section>
      )}

      <footer className="cust-foot live-foot">
        <p><Icon name="flask" size={15} />{t("Simulated orders are the team's own tests. They are never counted as real business.")}</p>
        <p><Icon name="network" size={15} />{t("The printers stay on the studio network. Only the studio's bridge talks to them, and it calls out to this site.")}</p>
        <p><Icon name="pulse" size={15} />{t("This page refreshes by itself every {n} s.", { n: seconds })}</p>
      </footer>
    </>
  );
}
