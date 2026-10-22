import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** The comfort card: one self-contained HTML file with its script and styles inlined. */
export const CARD_HTML = readFileSync(new URL("./title-comfort.html", import.meta.url), "utf8");

/** The URI includes a hash of the HTML, so a changed card is a new resource for hosts that cache. */
export const CARD_URI = `ui://everyseat/title-comfort-${createHash("sha256")
  .update(CARD_HTML)
  .digest("hex")
  .slice(0, 12)}.html`;

/** The card makes no requests and loads nothing, so it declares no allowed origins. */
export const CARD_META = {
  csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
  prefersBorder: false,
};
