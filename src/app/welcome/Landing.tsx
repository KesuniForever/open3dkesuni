import Icon, { type IconName } from "@/app/components/Icon";
import { DEMO_SCENARIOS } from "@/lib/demo";
import { SCENARIO_OUTCOMES, type VideoEmbed } from "@/lib/landing";
import type { T } from "@/i18n/core";

/**
 * Live numbers from the Live studio view, real business only (the team's tests are never counted); null when they could
 * not be read (the strip is left out). depositsVerified: real orders' escrow deposits read back from Arc with a match.
 */
export interface LandingStats { printersOnline: number; printersTotal: number; realOrders: number; realCustomers: number; depositsVerified: number }

type Actor = "agent" | "person" | "code" | "chain";
const ACTORS: { id: Actor; label: string }[] = [
  { id: "agent", label: "AI agent" }, { id: "person", label: "Person" }, { id: "code", label: "Code" }, { id: "chain", label: "Blockchain" },
];
const FLOW: { actor: Actor; icon: IconName; text: string }[] = [
  { actor: "person", icon: "orders", text: "Customer orders" },
  { actor: "agent", icon: "bot", text: "AI agent prices by weight and checks the owner's rules" },
  { actor: "chain", icon: "wallet", text: "Customer pays into escrow (Circle wallet on Arc)" },
  { actor: "code", icon: "printer", text: "Printers print and report live" },
  { actor: "person", icon: "star", text: "A person checks quality" },
  { actor: "person", icon: "check", text: "Customer accepts" },
  { actor: "code", icon: "shield", text: "Code releases the escrow to Kesuni" },
];
const PROBLEMS: { icon: IconName; title: string; text: string }[] = [
  { icon: "layers", title: "Too many jobs to track by hand", text: "Orders, weights, prices, printers and deadlines live in chats and notes." },
  { icon: "wrench", title: "Mistakes in the middle", text: "A wrong colour, a wrong price, a part left on the bed, a missed deadline." },
  {
    icon: "wallet", title: "Who pays first?",
    text: "The customer is afraid to pay before seeing the part; the studio is afraid to print before being paid. \"Print finished\" is not \"customer happy\".",
  },
];
const TECH: { icon: IconName; name: string; role: string; text: string }[] = [
  { icon: "bot", name: "Claude", role: "The AI agent", text: "One agent, five skills, no payment tool." },
  { icon: "wallet", name: "Circle", role: "The wallets", text: "One escrow wallet per order, gas paid by Circle." },
  { icon: "chain", name: "Arc", role: "The network", text: "USDC-native network: tiny fees, every transfer is public proof, and our code re-checks each one." },
];
const FEATURES: { icon: IconName; text: string }[] = [
  { icon: "calculator", text: "Price by weight from the slicer" },
  { icon: "shield", text: "The owner's rules in code" },
  { icon: "printer", text: "Live printers: colours, faults, camera for the team" },
  { icon: "layers", text: "Slicing and printing from the website" },
  { icon: "wallet", text: "Escrow per order, released only after acceptance" },
  { icon: "chain", text: "Every transfer re-checked on Arc" },
  { icon: "review", text: "Daily report for the owner" },
  { icon: "tag", text: "Honest labels: real or simulated" },
];
const PILOTS = [
  "An accessories shop (50 lighter cases)",
  "A graphic designer (modular lamps)",
  "A boarding-house owner who sells accessories",
];

/**
 * The landing page body, below the top bar: what Open3DKesuni is, for someone who has never seen it. Links only.
 * Without a demo video (DEMO_VIDEO_URL) there is no "Watch the demo" button and no video card.
 */
export default function Landing({ t, stats, video }: { t: T; stats: LandingStats | null; video: VideoEmbed | null }) {
  return (
    <>
      <section className="lp-hero">
        <div className="lp-hero-text">
          <ul className="lp-badges" aria-label={t("About the studio")}>
            <li><Icon name="box" size={14} />{t("Real studio · Padang, Indonesia")}</li>
            <li><Icon name="printer" size={14} />{t("3 Bambu Lab printers")}</li>
            <li><Icon name="chain" size={14} />{t("Circle wallets on Arc Testnet")}</li>
          </ul>
          <h1>{t("A 3D-print studio that runs itself, and gets paid only when the customer is happy.")}</h1>
          <p className="lp-lead">
            {t("Open3DKesuni is the order desk of Kesuni, a real 3D-print studio in Padang, Indonesia. An AI agent takes the orders, prices them, plans the printers and keeps the customer updated. The customer's money waits in a USDC escrow on Arc until they accept the part.")}
          </p>
          <div className="lp-actions">
            <a className="lp-btn primary" href="/live"><span className="live-dot" aria-hidden="true" />{t("See the studio live")}</a>
            <a className="lp-btn" href="/customer"><Icon name="box" size={15} />{t("Continue as customer")}</a>
            {video && <a className="lp-btn" href="#demo"><Icon name="play" size={15} />{t("Watch the demo")}</a>}
          </div>
        </div>
        <HeroVisual t={t} />
      </section>

      {stats && (
        <dl className="lp-stats" aria-label={t("Live numbers")}>
          <div><dt>{t("Printers online")}</dt><dd>{stats.printersOnline}<small>/{stats.printersTotal}</small></dd></div>
          <div><dt>{t("Real orders")}</dt><dd>{stats.realOrders}</dd></div>
          <div><dt>{t("Real customers")}</dt><dd>{stats.realCustomers}</dd></div>
          <div><dt>{t("Escrow deposits verified on Arc")}</dt><dd>{stats.depositsVerified}</dd></div>
        </dl>
      )}
      {stats && (
        <p className="lp-stats-note">
          {t("Live from the studio. Real orders only: the team's own tests are never counted. The deposits are test USDC on Arc Testnet.")}
        </p>
      )}

      <section className="lp-section" aria-labelledby="lp-problem">
        <p className="eyebrow">{t("The problem")}</p>
        <h2 id="lp-problem">{t("Running a small print studio is messy")}</h2>
        <div className="lp-grid three">
          {PROBLEMS.map((p) => (
            <article key={p.title} className="lp-card">
              <span className="lp-icon warn"><Icon name={p.icon} size={20} /></span>
              <h3>{t(p.title)}</h3>
              <p>{t(p.text)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section lp-why" aria-labelledby="lp-why">
        <p className="eyebrow">{t("Why this idea")}</p>
        <h2 id="lp-why">{t("We are the studio owners.")}</h2>
        <ul>
          <li><Icon name="bot" size={18} />{t("Routine decisions done by an agent.")}</li>
          <li><Icon name="shield" size={18} />{t("The business rules in code that cannot be talked around.")}</li>
          <li><Icon name="wallet" size={18} />{t("Money held apart, released only by rule.")}</li>
        </ul>
      </section>

      <section className="lp-section" aria-labelledby="lp-how">
        <p className="eyebrow">{t("How it works")}</p>
        <h2 id="lp-how">{t("From order to payment, step by step")}</h2>
        <ul className="lp-legend" aria-label={t("Who acts")}>
          {ACTORS.map((a) => <li key={a.id} className={`lp-actor ${a.id}`}>{t(a.label)}</li>)}
        </ul>
        <ol className="lp-flow">
          {FLOW.map((s, i) => (
            <li key={s.text} className={`lp-step ${s.actor}`}>
              <span className="lp-step-head">
                <span className="lp-step-n">{i + 1}</span>
                <Icon name={s.icon} size={18} />
                <span className="lp-step-who">{t(ACTORS.find((a) => a.id === s.actor)!.label)}</span>
              </span>
              <span className="lp-step-text">{t(s.text)}</span>
            </li>
          ))}
        </ol>
        {/* The other way out of step 6: on a wide screen it sits under steps 5-7 with its pointer on step 6. */}
        <p className="lp-branch">
          <span className="lp-step-n lp-branch-n" aria-hidden="true">6</span>
          <Icon name="close" size={15} />
          {t("If the customer rejects at step 6, code refunds the escrow to them.")}
        </p>
        <p className="lp-motto">{t("AI decides. Code constrains. The blockchain executes. Humans control the boundaries.")}</p>
      </section>

      <section className="lp-section" aria-labelledby="lp-tech">
        <p className="eyebrow">{t("The technology")}</p>
        <h2 id="lp-tech">{t("Three pieces, each with one job")}</h2>
        <div className="lp-grid three">
          {TECH.map((x) => (
            <article key={x.name} className="lp-card lp-tech">
              <span className="lp-icon"><Icon name={x.icon} size={20} /></span>
              <h3>{x.name} <small>{t(x.role)}</small></h3>
              <p>{t(x.text)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-features">
        <p className="eyebrow">{t("Features")}</p>
        <h2 id="lp-features">{t("What is built and working")}</h2>
        <ul className="lp-features">
          {FEATURES.map((f) => (
            <li key={f.text}><span className="lp-icon small"><Icon name={f.icon} size={17} /></span>{t(f.text)}</li>
          ))}
        </ul>
        <aside className="lp-note">
          <span className="lp-icon"><Icon name="network" size={20} /></span>
          <div>
            <h3>{t("Why three printers?")}</h3>
            <p>{t("They stand in for the partner studios we don't have yet: when one printer can't take a job, the agent picks another. Partner routing and the payment split are not built yet.")}</p>
          </div>
        </aside>
      </section>

      <section className="lp-section" id="demo" aria-labelledby="lp-demo">
        <p className="eyebrow">{t("Demo")}</p>
        <h2 id="lp-demo">{t("See it work")}</h2>
        {video && (
          <div className="lp-video">
            {video.kind === "iframe" ? (
              <iframe src={video.src} title={t("Open3DKesuni demo video")} loading="lazy"
                allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            ) : (
              <video src={video.src} controls preload="metadata" playsInline />
            )}
          </div>
        )}

        {/* The practice page itself is for the team (/demo needs the operator password): here only what each one shows. */}
        <h3 className="lp-sub">
          {t("{n} scenarios we test", { n: DEMO_SCENARIOS.length })}
        </h3>
        <p className="lp-small">{t("Each one runs the real rules engine on a practice order, labelled simulated and never counted.")}</p>
        <ul className="lp-grid three lp-scenarios">
          {DEMO_SCENARIOS.map((s) => (
            <li key={s.id} className="lp-card">
              <span className="badge">{t(s.tag)}</span>
              <h3>{t(s.title)}</h3>
              <p>{t(s.line)}</p>
              <p className="lp-outcome"><Icon name="chevron" size={14} />{t(SCENARIO_OUTCOMES[s.id])}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section" aria-labelledby="lp-who">
        <p className="eyebrow">{t("Who it is for")}</p>
        <h2 id="lp-who">{t("Small businesses that need small batches")}</h2>
        <div className="lp-who">
          <div className="lp-card">
            <h3>{t("Pilot customers in Padang")}</h3>
            <ul className="lp-list">
              {PILOTS.map((p) => <li key={p}><Icon name="check" size={16} />{t(p)}</li>)}
            </ul>
            <p className="lp-honest">{t("Pilot orders are running now. Payment is in rupiah, outside the app; the escrow deposits on Arc are test USDC from Kesuni's demo wallet, not customer money.")}</p>
          </div>
          <div className="lp-card">
            <h3>{t("It also helps")}</h3>
            <ul className="lp-list">
              <li><Icon name="printer" size={16} />{t("Print studios that juggle many small orders")}</li>
              <li><Icon name="network" size={16} />{t("Maker networks that share jobs between printers")}</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="lp-cta">
        <h2>{t("See it for yourself")}</h2>
        <div className="lp-actions">
          <a className="lp-btn primary" href="/live"><span className="live-dot" aria-hidden="true" />{t("See the studio live")}</a>
          <a className="lp-btn" href="/customer"><Icon name="box" size={15} />{t("Continue as customer")}</a>
          {/* A full page load on purpose: the browser asks for the operator password and the layout adds the sidebar. */}
          <a className="lp-btn ghost" href="/dashboard"><Icon name="orders" size={15} />{t("Operations dashboard (team login)")}</a>
        </div>
      </section>

      <footer className="lp-foot">
        {t("Built by the Kesuni team for the Tameion Agents Hackathon · Arc Testnet, test USDC · not real money")}
      </footer>
    </>
  );
}

/** The hero picture: an order card moving from the agent to escrow to the printer, drawn with HTML only. */
function HeroVisual({ t }: { t: T }) {
  return (
    <div className="lp-visual" aria-hidden="true">
      <div className="lp-vis-row agent"><Icon name="bot" size={18} /><span>{t("AI agent")}</span><b>{t("Priced by weight")}</b></div>
      <div className="lp-vis-row chain"><Icon name="wallet" size={18} /><span>{t("Escrow on Arc")}</span><b>{t("USDC held")}</b></div>
      <div className="lp-vis-row code"><Icon name="printer" size={18} /><span>{t("Printer")}</span><b>{t("Printing")}</b></div>
      <div className="lp-vis-row person"><Icon name="check" size={18} /><span>{t("Customer")}</span><b>{t("Accepts")}</b></div>
      <div className="lp-vis-done"><Icon name="shield" size={16} />{t("Paid only after acceptance")}</div>
    </div>
  );
}
