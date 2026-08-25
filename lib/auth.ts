import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { clientEnv, env } from "@/env";
import { CLOUDFLARE_OAUTH_PROVIDER_ID } from "@/lib/constants";

const cloudflareScopes =
  env.CLOUDFLARE_OAUTH_SCOPES.split(/\s+/).filter(Boolean);

const allowedHosts = [
  ...new Set([
    new URL(env.BETTER_AUTH_URL).host,
    new URL(clientEnv.NEXT_PUBLIC_APP_URL).host,
    "*.vercel.app",
  ]),
];

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  baseURL: {
    allowedHosts,
    fallback: env.BETTER_AUTH_URL,
  },
  basePath: "/api/auth",
  emailAndPassword: { enabled: false },
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    env.BETTER_AUTH_URL,
    clientEnv.NEXT_PUBLIC_APP_URL,
    "https://*.vercel.app",
  ],
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: CLOUDFLARE_OAUTH_PROVIDER_ID,
          discoveryUrl: env.CLOUDFLARE_OAUTH_DISCOVERY_URL,
          clientId: env.CLOUDFLARE_CLIENT_ID,
          clientSecret: env.CLOUDFLARE_CLIENT_SECRET,
          scopes: cloudflareScopes,
          pkce: true,
          authentication: "basic",
          mapProfileToUser: (profile) => {
            const email =
              typeof profile.email === "string"
                ? profile.email
                : `${String(profile.sub ?? "user")}@cloudflare.oauth`;
            const name =
              typeof profile.name === "string"
                ? profile.name
                : typeof profile.preferred_username === "string"
                  ? profile.preferred_username
                  : email;

            return {
              name,
              email,
              emailVerified: true,
            };
          },
        },
      ],
    }),
  ],
});
