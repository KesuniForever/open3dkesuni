// "Chat Kesuni on WhatsApp" on the customer pages: the studio's number comes from KESUNI_WHATSAPP, read by the server
// pages and passed down. Without a number there is no button (texts that say "on WhatsApp" stay true: Kesuni writes
// first). The customer starts the chat in their own WhatsApp, so their phone number never enters the app.
// No hooks and no "use client": server and client components both render it, and the helpers run on either side.

/** KESUNI_WHATSAPP as wa.me wants it: digits with the country code ("62812…"). A local "0812…" becomes "62812…";
 *  spaces, dashes and a leading + are dropped. Anything else is null (no button). */
export function whatsappNumber(raw: string | undefined): string | null {
  const digits = (raw ?? "").trim().replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^0(?=8)/, "62");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** A chat with Kesuni, with a first message the customer can still edit. */
export const waChatLink = (number: string, text?: string): string =>
  `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

/** WhatsApp's own "send to…" (no number): the customer picks a chat, for example their own, to keep a link. */
export const waShareLink = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** The button, or nothing without a number. `label` is already translated. */
export function WhatsAppButton({ number, text, label }: { number: string | null | undefined; text?: string; label: string }) {
  if (!number) return null;
  return <a className="btn-link cust-wa" href={waChatLink(number, text)} target="_blank" rel="noreferrer">{label}</a>;
}
