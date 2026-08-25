# Local Cloudflare simulation

Run rename/delete (and basic auth) against local OIDC + R2 REST mocks.

OIDC discovery and R2 API base URLs live in `lib/constants.ts` (not env). For a
full Next.js run against these mocks, temporarily point those constants at:

- `CLOUDFLARE_OAUTH_DISCOVERY_URL` → `http://127.0.0.1:8788/.well-known/openid-configuration`
- `CLOUDFLARE_API_BASE` → `http://127.0.0.1:8787/client/v4`

Restore the production Cloudflare URLs before committing.

## Services

| Process | Port | Script |
|---------|------|--------|
| R2 REST mock | 8787 | `node scripts/local-sim/r2-mock.mjs` |
| OIDC mock | 8788 | `node scripts/local-sim/oidc-mock.mjs` |
| Next.js | 3000 | `pnpm dev` |
| Postgres | 5432 | local install or `pnpm db:up` (compose uses 54321) |

Also set local OAuth client values in `.env`:

```env
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/next_template
CLOUDFLARE_CLIENT_ID=local-sim-client-id
CLOUDFLARE_CLIENT_SECRET=local-sim-client-secret
```

## Run checks

```bash
pnpm db:push
node scripts/local-sim/r2-mock.mjs &
node scripts/local-sim/oidc-mock.mjs &
pnpm dev --hostname 127.0.0.1 --port 3000 &
node scripts/local-sim/run-history-sim.mjs
```

The runner seeds a signed better-auth session, renames a history batch, deletes it (which DELETEs the R2 object on the mock), and confirms OAuth sign-in starts against the OIDC sim (when discovery is pointed at the mock).
