import { readFile } from "node:fs/promises";
import http from "node:http";

/** @typedef {{ connectDomains?: string[], resourceDomains?: string[], frameDomains?: string[], baseUriDomains?: string[] }} CardCsp */

/**
 * Keeps only plain host sources: a `;`, quote, space or newline could end the directive and
 * add another.
 * @param {unknown} domains
 * @returns {string[]}
 */
function cleanDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return domains.filter((domain) => typeof domain === "string" && !/[;\r\n'" ]/.test(domain));
}

/**
 * The Content-Security-Policy for a card, from the domains its resource declared.
 * Nothing outside the sandbox's own origin is reachable unless the card asked for it.
 * @param {CardCsp | undefined} csp
 */
export function cardPolicy(csp) {
  const resources = cleanDomains(csp?.resourceDomains).join(" ");
  const connect = cleanDomains(csp?.connectDomains).join(" ");
  const frames = cleanDomains(csp?.frameDomains).join(" ");
  const base = cleanDomains(csp?.baseUriDomains).join(" ");
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' blob: data: ${resources}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resources}`.trim(),
    `img-src 'self' data: blob: ${resources}`.trim(),
    `font-src 'self' data: blob: ${resources}`.trim(),
    `media-src 'self' data: blob: ${resources}`.trim(),
    `connect-src 'self' ${connect}`.trim(),
    `worker-src 'self' blob: ${resources}`.trim(),
    frames ? `frame-src ${frames}` : "frame-src 'none'",
    "object-src 'none'",
    base ? `base-uri ${base}` : "base-uri 'none'",
  ].join("; ");
}

/**
 * Serves the card sandbox on its own port, so it is a different origin from the page that
 * embeds it. The policy comes from the `csp` query parameter and is set as a response
 * header, which the card cannot change.
 * @param {{ port: number, host: string }} options
 */
export async function startSandbox({ port, host }) {
  const page = await readFile(new URL("./sandbox/sandbox.html", import.meta.url));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://sandbox.invalid");
    if (req.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/sandbox.html")) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Only the card sandbox is served here.");
      return;
    }
    /** @type {CardCsp | undefined} */
    let csp;
    try {
      const raw = url.searchParams.get("csp");
      if (raw) csp = JSON.parse(raw);
    } catch {
      csp = undefined;
    }
    res
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": cardPolicy(csp),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .end(page);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(undefined));
  });
  return server;
}
