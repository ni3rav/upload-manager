import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { uploadBatch, uploadItem } from "@/db/schema";
import { getCloudflareAccessToken } from "@/lib/cloudflare-token";
import { getUserTarget } from "@/lib/target";
import { requireAuth } from "@/middleware/auth";
import { tryCatch } from "@/lib/try-catch";
import { deleteObject } from "@/modules/cloudflare/r2";
import {
  buildCopyPayload,
  createHistoryBatchSchema,
  renameHistoryBatchSchema,
} from "./history.schema";

function createId() {
  return crypto.randomUUID();
}

async function findOwnedBatch(userId: string, batchId: string) {
  return db.query.uploadBatch.findFirst({
    where: and(eq(uploadBatch.id, batchId), eq(uploadBatch.userId, userId)),
    with: {
      items: {
        orderBy: (items, { asc }) => [asc(items.sortOrder)],
      },
    },
  });
}

export const historyRoutes = new Elysia({ prefix: "/history" })
  .use(requireAuth)
  .get("/", async ({ user, status }) => {
    const target = await getUserTarget(user.id);

    if (!target) {
      return { batches: [] };
    }

    const { data: batches, error } = await tryCatch(
      db.query.uploadBatch.findMany({
        where: and(
          eq(uploadBatch.userId, user.id),
          eq(uploadBatch.accountId, target.accountId),
          eq(uploadBatch.bucketName, target.bucketName),
        ),
        orderBy: [desc(uploadBatch.createdAt)],
        with: {
          items: {
            orderBy: (items, { asc }) => [asc(items.sortOrder)],
          },
        },
      }),
    );

    if (error) {
      return status(500, {
        error: "Failed to load upload history",
        batches: [],
      });
    }

    return {
      batches: batches.map((batch) => {
        const urls = batch.items.map((item) => item.publicUrl);
        return {
          id: batch.id,
          name: batch.name,
          createdAt: batch.createdAt.toISOString(),
          itemCount: batch.items.length,
          copyPayload: buildCopyPayload(urls),
          items: batch.items.map((item) => ({
            key: item.objectKey,
            publicUrl: item.publicUrl,
          })),
        };
      }),
    };
  })
  .post("/", async ({ user, body, status }) => {
    const parsed = createHistoryBatchSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, {
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", "),
      });
    }

    const { accountId, bucketName, publicBaseUrl, name, items } = parsed.data;
    const batchId = createId();

    const { error } = await tryCatch(
      db.transaction(async (tx) => {
        await tx.insert(uploadBatch).values({
          id: batchId,
          userId: user.id,
          accountId,
          bucketName,
          publicBaseUrl,
          name,
        });

        await tx.insert(uploadItem).values(
          items.map((item, index) => ({
            id: createId(),
            batchId,
            objectKey: item.key,
            publicUrl: item.publicUrl,
            sortOrder: index,
          })),
        );
      }),
    );

    if (error) {
      return status(500, { error: "Failed to save upload history" });
    }

    const urls = items.map((item) => item.publicUrl);

    return {
      batch: {
        id: batchId,
        name,
        createdAt: new Date().toISOString(),
        itemCount: items.length,
        copyPayload: buildCopyPayload(urls),
        items,
      },
    };
  })
  .patch(
    "/:id",
    async ({ user, params, body, status }) => {
      const parsed = renameHistoryBatchSchema.safeParse(body);
      if (!parsed.success) {
        return status(400, {
          error: parsed.error.issues[0]?.message ?? "Give this upload a name",
        });
      }

      const batch = await findOwnedBatch(user.id, params.id);
      if (!batch) {
        return status(404, { error: "Upload history not found" });
      }

      const { error } = await tryCatch(
        db
          .update(uploadBatch)
          .set({ name: parsed.data.name })
          .where(
            and(eq(uploadBatch.id, batch.id), eq(uploadBatch.userId, user.id)),
          ),
      );

      if (error) {
        return status(500, { error: "Failed to rename upload history" });
      }

      const urls = batch.items.map((item) => item.publicUrl);

      return {
        batch: {
          id: batch.id,
          name: parsed.data.name,
          createdAt: batch.createdAt.toISOString(),
          itemCount: batch.items.length,
          copyPayload: buildCopyPayload(urls),
          items: batch.items.map((item) => ({
            key: item.objectKey,
            publicUrl: item.publicUrl,
          })),
        },
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String(),
      }),
    },
  )
  .delete(
    "/:id",
    async ({ user, params, request, status }) => {
      const batch = await findOwnedBatch(user.id, params.id);
      if (!batch) {
        return status(404, { error: "Upload history not found" });
      }

      const { data: accessToken } = await getCloudflareAccessToken(
        request.headers,
      );
      if (!accessToken) {
        return status(401, {
          error:
            "Cloudflare is not connected. Sign in with Cloudflare to delete uploads.",
        });
      }

      const failedKeys: string[] = [];

      for (const item of batch.items) {
        const { error } = await deleteObject({
          accountId: batch.accountId,
          bucketName: batch.bucketName,
          key: item.objectKey,
          accessToken,
        });

        if (error) {
          failedKeys.push(item.objectKey);
        }
      }

      if (failedKeys.length > 0) {
        return status(502, {
          error:
            failedKeys.length === 1
              ? `Could not delete ${failedKeys[0]} from R2. History was not removed.`
              : `Could not delete ${failedKeys.length} files from R2. History was not removed.`,
          failedKeys,
        });
      }

      const { error } = await tryCatch(
        db
          .delete(uploadBatch)
          .where(
            and(eq(uploadBatch.id, batch.id), eq(uploadBatch.userId, user.id)),
          ),
      );

      if (error) {
        return status(500, {
          error:
            "Files were deleted from R2, but history could not be cleared. Refresh and try again.",
        });
      }

      return { deleted: true, id: batch.id };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
