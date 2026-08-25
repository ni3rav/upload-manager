import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  NODE_ENV: z.enum(["development", "production", "test"]),
  CLOUDFLARE_CLIENT_ID: z.string().min(1),
  CLOUDFLARE_CLIENT_SECRET: z.string().min(1),
  CLOUDFLARE_OAUTH_SCOPES: z.string().min(1),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});

function validateEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("Invalid server environment variables:\n", issues);
    throw new Error("Invalid server environment variables");
  }
  return parsed.data;
}

function validateClientEnv() {
  const parsed = clientSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("Invalid client environment variables:\n", issues);
    throw new Error("Invalid client environment variables");
  }
  return parsed.data;
}

export const env = validateEnv();
export const clientEnv = validateClientEnv();

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;
