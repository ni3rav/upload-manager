#!/usr/bin/env node
import http from "node:http";

const PORT = Number(process.env.R2_SIM_PORT ?? 8787);
const VALID_TOKEN = process.env.R2_SIM_TOKEN ?? "sim-cf-access-token";

/** @type {Map<string, { body: Buffer, contentType: string }>} */
const objects = new Map();

function objectKey(accountId, bucketName, key) {
  return `${accountId}/${bucketName}/${key}`;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function requireAuth(req, res) {
  const header = req.headers.authorization ?? "";
  if (header !== `Bearer ${VALID_TOKEN}`) {
    json(res, 401, {
      success: false,
      errors: [{ message: "Invalid access token" }],
      result: null,
    });
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const objectPath =
  /^\/client\/v4\/accounts\/([^/]+)\/r2\/buckets\/([^/]+)\/objects(?:\/(.+))?$/;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "GET" && url.pathname === "/__sim/objects") {
    json(res, 200, {
      objects: [...objects.keys()],
      count: objects.size,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/__sim/reset") {
    objects.clear();
    json(res, 200, { reset: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/__sim/seed") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const accountId = String(body.accountId ?? "");
    const bucketName = String(body.bucketName ?? "");
    const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
    for (const key of keys) {
      objects.set(objectKey(accountId, bucketName, key), {
        body: Buffer.from(`seed:${key}`),
        contentType: "image/jpeg",
      });
    }
    json(res, 200, { seeded: keys.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/client/v4/accounts") {
    if (!requireAuth(req, res)) {
      return;
    }
    json(res, 200, {
      success: true,
      errors: [],
      result: [{ id: "sim-account-1", name: "Sim Account" }],
    });
    return;
  }

  const bucketsList =
    /^\/client\/v4\/accounts\/([^/]+)\/r2\/buckets$/;
  const managedDomain =
    /^\/client\/v4\/accounts\/([^/]+)\/r2\/buckets\/([^/]+)\/domains\/managed$/;

  const bucketsMatch = bucketsList.exec(url.pathname);
  if (req.method === "GET" && bucketsMatch) {
    if (!requireAuth(req, res)) {
      return;
    }
    json(res, 200, {
      success: true,
      errors: [],
      result: {
        buckets: [{ name: "sim-bucket" }],
      },
    });
    return;
  }

  const managedMatch = managedDomain.exec(url.pathname);
  if (req.method === "GET" && managedMatch) {
    if (!requireAuth(req, res)) {
      return;
    }
    const bucketName = decodeURIComponent(managedMatch[2]);
    json(res, 200, {
      success: true,
      errors: [],
      result: {
        bucketId: bucketName,
        domain: "pub-sim.r2.dev",
        enabled: true,
      },
    });
    return;
  }

  const match = objectPath.exec(url.pathname);
  if (!match) {
    json(res, 404, {
      success: false,
      errors: [{ message: `No route for ${req.method} ${url.pathname}` }],
      result: null,
    });
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  const [, accountId, bucketName, rawKey] = match;
  const key = rawKey ? decodeURIComponent(rawKey) : null;

  if (req.method === "GET" && !key) {
    const prefix = url.searchParams.get("prefix") ?? "";
    const listed = [...objects.entries()]
      .filter(([id]) => id.startsWith(`${accountId}/${bucketName}/`))
      .map(([id]) => ({
        key: id.slice(`${accountId}/${bucketName}/`.length),
      }))
      .filter((item) => item.key.startsWith(prefix));
    json(res, 200, { success: true, errors: [], result: listed });
    return;
  }

  if (!key) {
    json(res, 400, {
      success: false,
      errors: [{ message: "Object key required" }],
      result: null,
    });
    return;
  }

  const id = objectKey(accountId, bucketName, key);

  if (req.method === "PUT") {
    const body = await readBody(req);
    objects.set(id, {
      body,
      contentType: req.headers["content-type"] ?? "application/octet-stream",
    });
    json(res, 200, { success: true, errors: [], result: { etag: "sim-etag" } });
    return;
  }

  if (req.method === "DELETE") {
    objects.delete(id);
    json(res, 200, { success: true, errors: [], result: null });
    return;
  }

  json(res, 405, {
    success: false,
    errors: [{ message: `Method ${req.method} not allowed` }],
    result: null,
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[r2-sim] listening on http://127.0.0.1:${PORT}`);
  console.log(`[r2-sim] bearer token: ${VALID_TOKEN}`);
});
