#!/usr/bin/env node
/**
 * Local integration checks for history rename/delete + session auth,
 * against the R2 and OIDC simulators.
 *
 * Prerequisites: postgres up, r2-mock + oidc-mock running, next dev running
 * with .env pointed at the sims (see scripts/local-sim/README.md).
 */
import { makeSignature } from "better-auth/crypto";
import pg from "pg";

const APP = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const R2_SIM = process.env.R2_SIM_URL ?? "http://127.0.0.1:8787";
const SECRET =
  process.env.BETTER_AUTH_SECRET ?? "replace-with-a-long-random-secret";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://user:password@127.0.0.1:5432/next_template";
const CF_TOKEN = process.env.R2_SIM_TOKEN ?? "sim-cf-access-token";

const USER_ID = "sim-user-1";
const SESSION_TOKEN = "sim-session-token-1";
const BATCH_ID = "sim-batch-1";
const ACCOUNT_ID = "sim-account-1";
const BUCKET = "sim-bucket";
const PUBLIC_BASE = "https://pub-sim.r2.dev";
const OBJECT_KEY = "party.jpg";

let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function signCookie(token) {
  const signature = await makeSignature(token, SECRET);
  return `better-auth.session_token=${token}.${signature}`;
}

async function seed(client) {
  await client.query(`DELETE FROM upload_item WHERE batch_id IN (
    SELECT id FROM upload_batch WHERE user_id = $1
  )`, [USER_ID]);
  await client.query(`DELETE FROM upload_batch WHERE user_id = $1`, [USER_ID]);
  await client.query(`DELETE FROM user_target WHERE user_id = $1`, [USER_ID]);
  await client.query(`DELETE FROM session WHERE user_id = $1`, [USER_ID]);
  await client.query(`DELETE FROM account WHERE user_id = $1`, [USER_ID]);
  await client.query(`DELETE FROM "user" WHERE id = $1`, [USER_ID]);

  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())`,
    [USER_ID, "Sim User", "sim@example.com"],
  );

  await client.query(
    `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
     VALUES ($1, NOW() + interval '7 days', $2, NOW(), NOW(), $3)`,
    ["sim-session-1", SESSION_TOKEN, USER_ID],
  );

  await client.query(
    `INSERT INTO account (
       id, account_id, provider_id, user_id, access_token, refresh_token,
       access_token_expires_at, created_at, updated_at
     ) VALUES ($1, $2, 'cloudflare', $3, $4, 'sim-refresh', NOW() + interval '1 hour', NOW(), NOW())`,
    ["sim-account-row-1", ACCOUNT_ID, USER_ID, CF_TOKEN],
  );

  await client.query(
    `INSERT INTO user_target (user_id, account_id, bucket_name, public_base_url, updated_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [USER_ID, ACCOUNT_ID, BUCKET, PUBLIC_BASE],
  );

  await client.query(
    `INSERT INTO upload_batch (
       id, user_id, account_id, bucket_name, public_base_url, name, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [BATCH_ID, USER_ID, ACCOUNT_ID, BUCKET, PUBLIC_BASE, "Original name"],
  );

  await client.query(
    `INSERT INTO upload_item (id, batch_id, object_key, public_url, sort_order)
     VALUES ($1, $2, $3, $4, 0)`,
    [
      "sim-item-1",
      BATCH_ID,
      OBJECT_KEY,
      `${PUBLIC_BASE}/${OBJECT_KEY}`,
    ],
  );
}

async function api(path, { method = "GET", cookie, body } = {}) {
  const headers = { Accept: "application/json" };
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${APP}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json, headers: response.headers };
}

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log("Seeding auth + history…");
  await seed(client);

  console.log("Seeding R2 sim objects…");
  await fetch(`${R2_SIM}/__sim/reset`, { method: "POST" });
  await fetch(`${R2_SIM}/__sim/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: ACCOUNT_ID,
      bucketName: BUCKET,
      keys: [OBJECT_KEY],
    }),
  });

  const cookie = await signCookie(SESSION_TOKEN);

  {
    const res = await api("/api/history");
    assert("history rejects unauthenticated", res.status === 401, `status=${res.status}`);
  }

  {
    const res = await api("/api/auth/get-session", { cookie });
    assert(
      "get-session returns seeded user",
      res.status === 200 && res.json?.user?.id === USER_ID,
      JSON.stringify(res.json),
    );
  }

  {
    const res = await api("/api/history", { cookie });
    assert(
      "history lists seeded batch",
      res.status === 200 &&
        Array.isArray(res.json?.batches) &&
        res.json.batches[0]?.name === "Original name",
      JSON.stringify(res.json),
    );
  }

  {
    const res = await api(`/api/history/${BATCH_ID}`, {
      method: "PATCH",
      cookie,
      body: { name: "Renamed party" },
    });
    assert(
      "rename updates batch name",
      res.status === 200 && res.json?.batch?.name === "Renamed party",
      JSON.stringify(res.json),
    );
  }

  {
    const before = await fetch(`${R2_SIM}/__sim/objects`).then((r) => r.json());
    assert(
      "r2 sim has object before delete",
      before.objects?.some((id) => id.endsWith(`/${OBJECT_KEY}`)),
      JSON.stringify(before),
    );

    const res = await api(`/api/history/${BATCH_ID}`, {
      method: "DELETE",
      cookie,
    });
    assert(
      "delete removes history batch",
      res.status === 200 && res.json?.deleted === true,
      JSON.stringify(res.json),
    );

    const after = await fetch(`${R2_SIM}/__sim/objects`).then((r) => r.json());
    assert(
      "r2 sim object deleted",
      !after.objects?.some((id) => id.endsWith(`/${OBJECT_KEY}`)),
      JSON.stringify(after),
    );
  }

  {
    const res = await api("/api/history", { cookie });
    assert(
      "history empty after delete",
      res.status === 200 && res.json?.batches?.length === 0,
      JSON.stringify(res.json),
    );
  }

  {
    const oauth = await api("/api/auth/sign-in/oauth2", {
      method: "POST",
      body: {
        providerId: "cloudflare",
        callbackURL: "/select-target",
      },
    });
    const url = oauth.json?.url ?? oauth.json?.data?.url;
    assert(
      "oauth start returns authorize url",
      typeof url === "string" && /oauth2\/auth|authorize/.test(url),
      JSON.stringify(oauth.json),
    );
  }

  await client.end();

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll local sim checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
