import { Fragment, type ReactNode } from "react";
import { BrandMark } from "@/app/components/Icon";
import LangSwitch from "@/app/components/LangSwitch";
import "./customer.css";

/** Header of the customer pages: brand on the left; a short label and the EN | ID switch on the right. */
export function CustTop({ children }: { children?: ReactNode }) {
  return (
    <header className="cust-top">
      <span className="brand"><BrandMark size={30} />Open3DKesuni</span>
      <div className="cust-top-right">
        {children != null && children !== false && <span className="muted">{children}</span>}
        <LangSwitch />
      </div>
    </header>
  );
}

/** Renders a translated sentence that marks bold words as <b>…</b>, so the bold can move with the words. */
export function bold(text: string): ReactNode {
  return text.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}
