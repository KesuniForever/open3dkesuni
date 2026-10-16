import { Fragment, type ReactNode } from "react";
import { BrandMark } from "@/app/components/Icon";
import LangSwitch from "@/app/components/LangSwitch";
import "./customer.css";

/**
 * Header of the customer pages: brand on the left (a link: `home`, the customer pages pass the portal so an order page
 * always has a way out); a short label, an optional link (the landing page's "Dashboard") and the EN | ID switch on the
 * right. A plain link, not a client navigation: /customer is the proxy's rewrite of the portal.
 */
export function CustTop({ children, action, home = "/" }: { children?: ReactNode; action?: ReactNode; home?: string }) {
  return (
    <header className="cust-top">
      <a className="brand" href={home}><BrandMark size={30} />Open3DKesuni</a>
      <div className={`cust-top-right${action ? " has-action" : ""}`}>
        {children != null && children !== false && <span className="muted">{children}</span>}
        {action}
        <LangSwitch />
      </div>
    </header>
  );
}

/** Renders a translated sentence that marks bold words as <b>…</b>, so the bold can move with the words. */
export function bold(text: string): ReactNode {
  return text.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}
