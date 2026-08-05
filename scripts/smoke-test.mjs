import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const HOST = "127.0.0.1";
const PORT = Number(process.env.SMOKE_PORT ?? 3100);
const BASE_URL = process.env.SMOKE_BASE_URL ?? `http://${HOST}:${PORT}`;
const START_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 120_000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function getJson(pathname, expectedStatuses = [200]) {
  const url = new URL(pathname, BASE_URL);
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${url.pathname} returned non-JSON content with status ${response.status}`);
  }

  assert(
    expectedStatuses.includes(response.status),
    `${url.pathname} returned ${response.status}; expected ${expectedStatuses.join(" or ")}${
      typeof data?.error === "string" ? `: ${data.error}` : ""
    }`
  );

  return data;
}

function validateProvider(provider) {
  assert(isObject(provider.capabilities), `${provider.id} has no capabilities object`);
  assert(isObject(provider.map), `${provider.id} has no map configuration`);
  assert(isObject(provider.map.center), `${provider.id} has no map center`);
  assert(Number.isFinite(provider.map.center.lat), `${provider.id} has an invalid map latitude`);
  assert(Number.isFinite(provider.map.center.lng), `${provider.id} has an invalid map longitude`);
  assert(Number.isFinite(provider.map.defaultZoom), `${provider.id} has an invalid default zoom`);
}

const tests = [
  {
    name: "Provider registry",
    run: async () => {
      const data = await getJson("/api/providers");
      assert(data.defaultProviderId === "king-county", "Default provider is not king-county");
      assert(Array.isArray(data.providers), "Provider response does not contain an array");

      const providers = new Map(data.providers.map((provider) => [provider.id, provider]));

      for (const providerId of ["king-county", "spokane-county"]) {
        assert(providers.has(providerId), `Missing provider: ${providerId}`);
        validateProvider(providers.get(providerId));
      }

      assert(
        providers.get("king-county").capabilities.taxDelinquency === true,
        "King County should support tax delinquency"
      );
      assert(
        providers.get("spokane-county").capabilities.mapBounds === true,
        "Spokane County should support map bounds"
      );
      assert(
        providers.get("spokane-county").capabilities.taxDelinquency === false,
        "Spokane County should not claim tax-delinquency support"
      );
    },
  },
  {
    name: "Unknown provider rejection",
    run: async () => {
      const data = await getJson("/api/properties?provider=not-real", [400]);
      assert(
        typeof data.error === "string" && data.error.includes("Unknown property provider"),
        "Unknown provider returned the wrong error message"
      );
    },
  },
  {
    name: "Invalid map-bounds rejection",
    run: async () => {
      const data = await getJson(
        "/api/properties?provider=spokane-county&west=-117.5&south=47.5&east=-117.4",
        [400]
      );
      assert(
        typeof data.error === "string" && data.error.includes("west, south, east, and north"),
        "Invalid map bounds returned the wrong error message"
      );
    },
  },
  {
    name: "Spokane visible-map parcels",
    run: async () => {
      const data = await getJson(
        "/api/properties?provider=spokane-county&limit=10&offset=0&west=-117.44&south=47.65&east=-117.41&north=47.67"
      );

      assert(Array.isArray(data.properties), "Spokane response does not contain properties");
      assert(isObject(data.pagination), "Spokane response has no pagination object");
      assert(data.properties.length > 0, "Spokane map-bounds query returned no parcels");

      for (const property of data.properties) {
        assert(property.status === "parcel", `Spokane parcel ${property.id} is not neutral`);
        assert(
          Array.isArray(property.signals) && property.signals.includes("parcel"),
          `Spokane parcel ${property.id} is missing the parcel signal`
        );
      }
    },
  },
  {
    name: "Spokane unsupported tax filter",
    run: async () => {
      const data = await getJson(
        "/api/properties?provider=spokane-county&signal=tax-delinquent",
        [400, 500]
      );
      assert(
        typeof data.error === "string" &&
          data.error.includes("does not support tax-delinquency filtering"),
        "Spokane tax-filter rejection returned the wrong error message"
      );
    },
  },
  {
    name: "King County property list",
    run: async () => {
      const data = await getJson(
        "/api/properties?provider=king-county&limit=1&offset=0"
      );
      assert(Array.isArray(data.properties), "King County response does not contain properties");
      assert(data.properties.length > 0, "King County returned no properties");
      assert(isObject(data.pagination), "King County response has no pagination object");
    },
  },
];

function startServer() {
  if (process.env.SMOKE_BASE_URL) {
    return null;
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  const child = spawn(
    npmCommand,
    ["run", "dev", "--", "--hostname", HOST, "--port", String(PORT)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  return child;
}

async function waitForServer(child) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (child && child.exitCode !== null) {
      throw new Error(`Development server exited with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/api/providers`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });

      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("Development server did not become ready within 120 seconds");
}

function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function main() {
  console.log(`VacantWatch smoke tests: ${BASE_URL}`);
  const server = startServer();

  try {
    await waitForServer(server);

    let failures = 0;

    for (const test of tests) {
      const startedAt = Date.now();

      try {
        await test.run();
        console.log(`PASS ${test.name} (${Date.now() - startedAt} ms)`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${test.name}`);
        console.error(error instanceof Error ? error.message : error);
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} smoke test${failures === 1 ? "" : "s"} failed`);
    }

    console.log(`All ${tests.length} smoke tests passed.`);
  } finally {
    stopServer(server);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
