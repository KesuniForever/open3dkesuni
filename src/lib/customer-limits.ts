// Limits for the customer routes that take a design from the internet: the order form (POST /api/c) and "Add your
// design" on the order page (POST /api/c/<token>/design). Both count against the same numbers, per network address per
// hour, and share the slots for designs being received (each is held in memory, up to 25 MB, until it is checked,
// measured and stored).
// Kept in memory on globalThis (one copy across a dev server's hot reloads); a restart clears them.

export const HOUR = 3_600_000;
/** Every try counts, refused ones too (wrong code or link, bad file, missing field), before the body is read. */
export const TRIES_PER_IP_PER_HOUR = 30;
export const DESIGNS_PER_IP_PER_HOUR = 10;
/** Designs received at the same time (read, checked, measured and stored). */
export const DESIGNS_AT_ONCE = 2;

export const TOO_MANY_TRIES = "Too many tries in one hour. Try again later or contact Kesuni.";
export const TOO_MANY_DESIGNS = "Too many designs sent in one hour. Try again later or contact Kesuni.";
export const BUSY_READING = "Kesuni is receiving other designs right now. Try again in a minute.";
export const DESIGN_TOO_BIG = "Your design is larger than 25 MB. Send it on WhatsApp instead.";
export const CROSS_SITE = "Blocked: this request came from another site.";

const g = globalThis as unknown as {
  __kesuniOrderTries?: Map<string, number[]>; __kesuniDesignTries?: Map<string, number[]>; __kesuniDesignsReading?: { n: number };
};
/** Tries per address (both routes). */
export const tries = (g.__kesuniOrderTries ??= new Map<string, number[]>());
/** Designs sent per address (both routes). */
export const designTries = (g.__kesuniDesignTries ??= new Map<string, number[]>());
const reading = (g.__kesuniDesignsReading ??= { n: 0 });

/** This address's times in the last hour (addresses with none are dropped, so the map does not grow forever). */
export function recentFor(map: Map<string, number[]>, ip: string, now: number): number[] {
  if (map.size > 2000) for (const [k, v] of map) if (!v.some((t) => now - t < HOUR)) map.delete(k);
  return (map.get(ip) ?? []).filter((t) => now - t < HOUR);
}

/** Counts one try for this address; false when it already used up `max` this hour. */
export function take(map: Map<string, number[]>, ip: string, now: number, max: number): boolean {
  const recent = recentFor(map, ip, now);
  if (recent.length >= max) return false;
  map.set(ip, [...recent, now]);
  return true;
}

/** Receives one design while holding one of the DESIGNS_AT_ONCE slots (`read` ends once it is stored or refused);
 *  "busy" when every slot is taken. */
export async function readingDesign<T>(read: () => Promise<T>): Promise<T | "busy"> {
  if (reading.n >= DESIGNS_AT_ONCE) return "busy";
  reading.n++;
  try {
    return await read();
  } finally {
    reading.n--;
  }
}

/** A plain form on another site can post multipart without a CORS check: only this site's own pages may send designs. */
export const crossSite = (req: Request): boolean => req.headers.get("sec-fetch-site") === "cross-site";
