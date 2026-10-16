// The orders placed from this browser, so the customer portal's "My orders" can list them without an account.
// Only the order page links (/c/<token>) and a short label are kept, in this browser's localStorage. Storage can be
// missing or blocked (private window): every call then does nothing, and the order page link still works on its own.
const KEY = "kesuni_my_orders";
const MAX = 20;

export interface RememberedOrder {
  link: string;    // "/c/<token>"
  product: string; // what the customer typed, for the list
  at: string;      // ISO time the order was sent
}

const isLink = (v: unknown): v is string => typeof v === "string" && /^\/c\/[A-Za-z0-9_-]{8,128}$/.test(v);

export function listRemembered(): RememberedOrder[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((o) => o && isLink(o.link))
      .map((o) => ({ link: o.link, product: String(o.product ?? "").slice(0, 200), at: String(o.at ?? "") }));
  } catch {
    return [];
  }
}

/** Call after the order form succeeds, with the link the API returned. Newest first, no duplicates. */
export function rememberOrder(link: string, product: string, now = new Date()): void {
  if (!isLink(link)) return;
  try {
    const rest = listRemembered().filter((o) => o.link !== link);
    const next = [{ link, product: product.slice(0, 200), at: now.toISOString() }, ...rest].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the order page link still works */
  }
}

/**
 * The order page itself, each time it loads: kept when this browser does not list it yet (an order from before the
 * list existed, made by Kesuni, or opened from WhatsApp). One already listed keeps its place and time.
 */
export function rememberIfNew(link: string, product: string, now = new Date()): void {
  if (!listRemembered().some((o) => o.link === link)) rememberOrder(link, product, now);
}

export function forgetOrder(link: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(listRemembered().filter((o) => o.link !== link)));
  } catch {
    /* nothing to forget */
  }
}
