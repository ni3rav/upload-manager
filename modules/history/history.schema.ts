import { z } from "zod";

export const historyItemSchema = z.object({
  key: z.string().min(1),
  publicUrl: z.url(),
});

export const batchNameSchema = z
  .string()
  .trim()
  .min(1, "Give this upload a name")
  .max(100, "Name must be 100 characters or fewer");

export const createHistoryBatchSchema = z.object({
  accountId: z.string().min(1),
  bucketName: z.string().min(1),
  publicBaseUrl: z.url(),
  name: batchNameSchema,
  items: z.array(historyItemSchema).min(1),
});

export type CreateHistoryBatchInput = z.infer<typeof createHistoryBatchSchema>;

export const historyBatchSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  itemCount: z.number(),
  copyPayload: z.string(),
  items: z.array(historyItemSchema),
});

export type HistoryBatch = z.infer<typeof historyBatchSchema>;

export const historyListResponseSchema = z.object({
  batches: z.array(historyBatchSchema),
  error: z.string().optional(),
});

export type HistoryListResponse = z.infer<typeof historyListResponseSchema>;

export const renameHistoryBatchSchema = z.object({
  name: batchNameSchema,
});

export type RenameHistoryBatchInput = z.infer<typeof renameHistoryBatchSchema>;

export function buildCopyPayload(urls: string[]): string {
  if (urls.length === 1) {
    return urls[0];
  }
  return urls.join(",");
}
