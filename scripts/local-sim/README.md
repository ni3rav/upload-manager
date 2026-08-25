# Local Cloudflare simulation

Run rename/delete (and basic auth) against local OIDC + R2 REST mocks.

## Services

| Process | Port | Script |
|---------|------|--------|
| R2 REST mock | 8787 | `node scripts/local-sim/r2-mock.mjs` |
| OIDC mock | 8788 | `node scripts/local-sim/oidc-mock.mjs` |
| Next.js | 3000 | `pnpm dev` |
| Postgres | 5432 | local install or `pnpm db:up` (compose uses 54321) |

Point `.env` at the mocks:

```env
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/next_template
CLOUDFLARE_CLIENT_ID=local-sim-client-id
CLOUDFLARE_CLIENT_SECRET=local-sim-client-secret
CLOUDFLARE_OAUTH_DISCOVERY_URL=http://127.0.0.1:8788/.well-known/openid-configuration
CLOUDFLARE_API_BASE=http://127.0.0.1:8787/client/v4
```

## Run checks

```bash
pnpm db:push
node scripts/local-sim/r2-mock.mjs &
node scripts/local-sim/oidc-mock.mjs &
pnpm dev &
node scripts/local-sim/run-history-sim.mjs
```

The runner seeds a signed better-auth session, renames a history batch, deletes it (which DELETEs the R2 object on the mock), and confirms OAuth sign-in starts against the OIDC sim.
