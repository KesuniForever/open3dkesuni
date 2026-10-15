import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

/** A soft panel with an icon, a bold line and one sentence (TIMBAL style), e.g. "Read the network, without authority to send funds". */
export default function Callout({ icon = "shield", title, children, tone = "green", aside }: {
  icon?: IconName; title: string; children?: ReactNode; tone?: "green" | "blue" | "amber"; aside?: ReactNode;
}) {
  return (
    <div className={`callout ${tone}`}>
      <span className="callout-icon"><Icon name={icon} /></span>
      <div className="callout-body"><b>{title}</b>{children && <span>{children}</span>}</div>
      {aside && <div className="callout-aside">{aside}</div>}
    </div>
  );
}
