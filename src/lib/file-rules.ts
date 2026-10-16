// Rules about order files that the order page needs too. No Node imports: FilesPanel runs in the browser.
import type { Order } from "./types";

/** A QC photo is photo evidence: it can go only until the evidence is submitted (the customer and the escrow release rely on it after). */
export const QC_REMOVABLE: readonly Order["status"][] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];

/** Why a QC photo of an order in this status cannot be removed; null when it can. English (pages show it with tLib). */
export const qcPhotoLocked = (status: Order["status"]): string | null =>
  QC_REMOVABLE.includes(status) ? null : `Order is ${status}; a QC photo stays once evidence is submitted`;
