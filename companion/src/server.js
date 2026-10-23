import http from "node:http";
import os from "node:os";
import { createApp, isAuthorized } from "./app.js";
import { loadCatalog } from "./catalog.js";
import { loadConfig } from "./config.js";
import { restoreHousehold } from "./household.js";
import { Relay } from "./relay.js";
import { startSandbox } from "./sandbox.js";
import { createStore } from "./store/index.js";

const config = loadConfig();
const catalog = await loadCatalog(config);
const store = await createStore(config.store);

/**
 * Where a phone opens the description page: the bind address, or every local network
 * address when the server listens on all of them.
 * @param {import("./config.js").Config} settings
 */
function phoneUrls(settings) {
  const hosts =
    settings.host === "0.0.0.0" || settings.host === "::"
      ? Object.values(os.networkInterfaces())
          .flatMap((addresses) => addresses ?? [])
          .filter((address) => address.family === "IPv4" && !address.internal)
          .map((address) => address.address)
      : [settings.host];
  return hosts.map((host) => `http://${host}:${settings.port}/phone/`);
}

const relay = new Relay({
  heartbeatMs: config.heartbeatMs,
  replayLens: config.replayLens,
  onHousehold: (household, message) => {
    store.setHousehold(household, message.people, message.updatedAt).catch((error) => {
      console.error("could not save the household", error);
    });
  },
  onLens: (household, message) => {
    store.saveTonight(household, message).catch((error) => {
      console.error("could not save tonight's couch", error);
    });
  },
  authorize: (request, url) => isAuthorized(config, request, url),
  log: (message) => console.info(message),
});

await restoreHousehold({
  store,
  relay,
  household: config.household,
  demoFile: config.demoHousehold ? config.demoHouseholdFile : undefined,
});

const server = http.createServer(createApp({ config, catalog, store, relay }));
relay.attach(server);
const sandbox = await startSandbox({ port: config.sandboxPort, host: config.host });

server.listen(config.port, config.host, () => {
  const titles = catalog.titles.map((title) => title.id).join(", ");
  console.info(`companion listening on http://${config.host}:${config.port} (mcp at /mcp, relay at /relay)`);
  console.info(`card sandbox on http://${config.host}:${config.sandboxPort}`);
  console.info(`titles: ${titles || "none"}`);
  for (const url of phoneUrls(config)) console.info(`phone page: ${url}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    relay.close();
    sandbox.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
    sandbox.closeAllConnections();
  });
}
