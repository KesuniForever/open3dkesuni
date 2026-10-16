import Icon from "./Icon";
import type { T } from "@/i18n/core";

/**
 * The team's way in, top right on the public pages (landing, /live): a lock and "Team login". Under 420px only the
 * lock shows (landing.css), so it never covers the Open3DKesuni name; the link keeps its name for screen readers.
 * A full page load on purpose: from the internet the browser asks for the operator password, and the layout adds
 * the sidebar.
 */
export default function TeamLogin({ t }: { t: T }) {
  const label = t("Team login");
  return (
    <a className="lp-btn ghost lp-top-dash" href="/dashboard" aria-label={label} title={label}>
      <Icon name="lock" size={14} /><span className="lp-top-label">{label}</span>
    </a>
  );
}
