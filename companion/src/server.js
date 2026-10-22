import http from "node:http";
import { createApp, isAuthorized } from "./app.js";
import { loadCatalog } from "./catalog.js";
import { loadConfig } from "./config.js";
import { Relay } from "./relay.js";
import { createStore } from "./store/index.js";

const config = loadConfig();
const catalog = await loadCatalog(config);
const store = await createStore(config.store);

const relay = new Relay({
  heartbeatMs: config.heartbeatMs,
  replayLens: config.replayLens,
  authorize: (request, url) => isAuthorized(config, request, url),
  log: (message) => console.info(message),
});

const server = http.createServer(createApp({ config, catalog, store, relay }));
relay.attach(server);

server.listen(config.port, config.host, () => {
  const titles = catalog.titles.map((title) => title.id).join(", ");
  console.info(`companion listening on http://${config.host}:${config.port} (mcp at /mcp, relay at /relay)`);
  console.info(`titles: ${titles || "none"}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    relay.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
