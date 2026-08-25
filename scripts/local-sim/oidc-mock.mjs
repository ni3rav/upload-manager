#!/usr/bin/env node
import http from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.OIDC_SIM_PORT ?? 8788);
const CLIENT_ID = process.env.CLOUDFLARE_CLIENT_ID ?? "local-sim-client-id";
const CLIENT_SECRET =
  process.env.CLOUDFLARE_CLIENT_SECRET ?? "local-sim-client-secret";
const ISSUER = `http://127.0.0.1:${PORT}`;

/** @type {Map<string, { codeChallenge?: string, redirectUri: string, user: object }>} */
const authCodes = new Map();
/** @type {Map<string, { user: object }>} */
const accessTokens = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseForm(raw) {
  return Object.fromEntries(new URLSearchParams(raw));
}

function basicAuth(req) {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) {
    return null;
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const [id, secret] = decoded.split(":");
  return { id, secret };
}

const defaultUser = {
  sub: "sim-cf-user-1",
  email: "sim@cloudflare.oauth",
  name: "Sim Cloudflare User",
  preferred_username: "sim-user",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);

  if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
    json(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth2/auth`,
      token_endpoint: `${ISSUER}/oauth2/token`,
      userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
      jwks_uri: `${ISSUER}/oauth2/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: [
        "openid",
        "account-settings.read",
        "account-analytics.read",
        "workers-r2.write",
        "user-details.read",
      ],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth2/jwks") {
    json(res, 200, { keys: [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth2/auth") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") ?? "";
    const codeChallenge = url.searchParams.get("code_challenge") ?? undefined;
    if (!redirectUri) {
      json(res, 400, { error: "missing redirect_uri" });
      return;
    }
    const code = randomBytes(16).toString("hex");
    authCodes.set(code, {
      codeChallenge,
      redirectUri,
      user: defaultUser,
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    res.writeHead(302, { Location: target.toString() });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/oauth2/token") {
    const raw = await readBody(req);
    const form = parseForm(raw);
    const basic = basicAuth(req);
    const clientId = basic?.id ?? form.client_id;
    const clientSecret = basic?.secret ?? form.client_secret;
    if (clientId !== CLIENT_ID || clientSecret !== CLIENT_SECRET) {
      json(res, 401, { error: "invalid_client" });
      return;
    }
    const entry = authCodes.get(String(form.code ?? ""));
    if (!entry) {
      json(res, 400, { error: "invalid_grant" });
      return;
    }
    authCodes.delete(String(form.code));
    const accessToken =
      process.env.R2_SIM_TOKEN ?? "sim-cf-access-token";
    accessTokens.set(accessToken, { user: entry.user });
    const now = Math.floor(Date.now() / 1000);
    const idToken = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          ...entry.user,
          iss: ISSUER,
          aud: CLIENT_ID,
          iat: now,
          exp: now + 3600,
          email_verified: true,
        }),
      ).toString("base64url"),
      "",
    ].join(".");
    json(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: `sim-refresh-${randomBytes(12).toString("hex")}`,
      scope: form.scope ?? "",
      id_token: idToken,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/oauth2/userinfo") {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const entry = accessTokens.get(token);
    if (!entry) {
      json(res, 401, { error: "invalid_token" });
      return;
    }
    json(res, 200, entry.user);
    return;
  }

  json(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[oidc-sim] discovery ${ISSUER}/.well-known/openid-configuration`);
});
