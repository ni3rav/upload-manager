import { tryCatch } from "@/lib/try-catch";

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

export function buildPublicUrl(publicBaseUrl: string, key: string): string {
  const base = publicBaseUrl.replace(/\/$/, "");
  return `${base}/${encodeURIComponent(key)}`;
}

export function buildDashboardUrl(
  accountId: string,
  bucketName: string,
): string {
  return `https://dash.cloudflare.com/${accountId}/r2/default/buckets/${encodeURIComponent(bucketName)}`;
}

function encodeObjectKeyForApi(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment.replace(/%/g, "%25")))
    .join("/");
}

function objectUrl(accountId: string, bucketName: string, key: string): string {
  return `${CLOUDFLARE_API_BASE}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects/${encodeObjectKeyForApi(key)}`;
}

export async function objectExists({
  accountId,
  bucketName,
  key,
  accessToken,
}: {
  accountId: string;
  bucketName: string;
  key: string;
  accessToken: string;
}): Promise<{ exists: boolean; error: string | null }> {
  const listUrl = new URL(
    `${CLOUDFLARE_API_BASE}/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucketName)}/objects`,
  );
  listUrl.searchParams.set("prefix", key);
  listUrl.searchParams.set("per_page", "20");

  const { data: response, error } = await tryCatch(
    fetch(listUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
  );

  if (error) {
    return { exists: false, error: "Could not reach Cloudflare R2" };
  }

  if (response.status === 404) {
    return { exists: false, error: null };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      exists: false,
      error: "Cloudflare access token is missing required R2 permissions",
    };
  }

  if (!response.ok) {
    return {
      exists: false,
      error: `Cloudflare R2 returned status ${response.status}`,
    };
  }

  const { data: payload } = await tryCatch(
    response.json() as Promise<{
      result?: Array<{ key?: string }> | { objects?: Array<{ key?: string }> };
    }>,
  );

  let objects: Array<{ key?: string }> = [];
  if (Array.isArray(payload?.result)) {
    objects = payload.result;
  } else if (
    payload?.result &&
    typeof payload.result === "object" &&
    Array.isArray(payload.result.objects)
  ) {
    objects = payload.result.objects;
  }

  return {
    exists: objects.some((object) => object.key === key),
    error: null,
  };
}

export async function putObject({
  accountId,
  bucketName,
  key,
  body,
  contentType,
  accessToken,
}: {
  accountId: string;
  bucketName: string;
  key: string;
  body: ArrayBuffer | Blob;
  contentType: string;
  accessToken: string;
}): Promise<{ etag: string | null; error: string | null }> {
  const { data: response, error } = await tryCatch(
    fetch(objectUrl(accountId, bucketName, key), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
      },
      body,
    }),
  );

  if (error) {
    return { etag: null, error: "Could not reach Cloudflare R2" };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        etag: null,
        error: "Cloudflare access token is missing required R2 permissions",
      };
    }

    const { data: payload } = await tryCatch(
      response.json() as Promise<{ errors?: Array<{ message?: string }> }>,
    );
    const message =
      payload?.errors?.[0]?.message ??
      `Cloudflare R2 upload failed with status ${response.status}`;
    return { etag: null, error: message };
  }

  const { data: payload } = await tryCatch(
    response.json() as Promise<{
      result?: { etag?: string };
    }>,
  );

  return {
    etag: payload?.result?.etag ?? null,
    error: null,
  };
}

export async function deleteObject({
  accountId,
  bucketName,
  key,
  accessToken,
}: {
  accountId: string;
  bucketName: string;
  key: string;
  accessToken: string;
}): Promise<{ error: string | null }> {
  const { data: response, error } = await tryCatch(
    fetch(objectUrl(accountId, bucketName, key), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
  );

  if (error) {
    return { error: "Could not reach Cloudflare R2" };
  }

  if (response.status === 404) {
    return { error: null };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return {
        error: "Cloudflare access token is missing required R2 permissions",
      };
    }

    const { data: payload } = await tryCatch(
      response.json() as Promise<{ errors?: Array<{ message?: string }> }>,
    );
    const message =
      payload?.errors?.[0]?.message ??
      `Cloudflare R2 delete failed with status ${response.status}`;
    return { error: message };
  }

  return { error: null };
}
