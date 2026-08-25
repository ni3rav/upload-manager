import { env } from "@/env";
import { tryCatch } from "@/lib/try-catch";

type CloudflareApiResponse<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
};

type CloudflareAccount = {
  id: string;
  name: string;
};

type CloudflareBucket = {
  name: string;
};

type CloudflareManagedDomain = {
  bucketId: string;
  domain: string;
  enabled: boolean;
};

async function cloudflareRequest<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
) {
  const { data: response, error } = await tryCatch(
    fetch(`${env.CLOUDFLARE_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    }),
  );

  if (error) {
    return { data: null, error };
  }

  const { data: payload, error: parseError } = await tryCatch(
    response.json() as Promise<CloudflareApiResponse<T>>,
  );

  if (parseError) {
    return { data: null, error: parseError };
  }

  if (!response.ok || !payload.success) {
    const message =
      payload.errors?.[0]?.message ??
      `Cloudflare API request failed (${response.status})`;
    return { data: null, error: new Error(message) };
  }

  return { data: payload.result, error: null };
}

export async function listCloudflareAccounts(accessToken: string) {
  const { data, error } = await cloudflareRequest<CloudflareAccount[]>(
    accessToken,
    "/accounts",
  );

  if (error) {
    return { data: null, error };
  }

  return {
    data: data.map((account) => ({
      id: account.id,
      name: account.name,
    })),
    error: null,
  };
}

export async function listBucketsWithPublicDevUrl(
  accessToken: string,
  accountId: string,
) {
  const { data: buckets, error } = await cloudflareRequest<{
    buckets: CloudflareBucket[];
  }>(accessToken, `/accounts/${accountId}/r2/buckets`);

  if (error) {
    return { data: null, error };
  }

  const publicBuckets: Array<{
    name: string;
    publicBaseUrl: string;
  }> = [];

  for (const bucket of buckets.buckets) {
    const { data: managed, error: managedError } =
      await cloudflareRequest<CloudflareManagedDomain>(
        accessToken,
        `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket.name)}/domains/managed`,
      );

    if (managedError || !managed.enabled || !managed.domain) {
      continue;
    }

    publicBuckets.push({
      name: bucket.name,
      publicBaseUrl: `https://${managed.domain}`,
    });
  }

  return { data: publicBuckets, error: null };
}
