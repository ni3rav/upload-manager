"use client";

import { useCallback, useEffect, useState } from "react";
import { tryCatch } from "@/lib/try-catch";
import { CopyIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { MessagePanel, COPY } from "@/components/app/messages";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import type { HistoryBatch } from "@/modules/history";
import type { UserTarget } from "@/modules/target";

type HistoryTabProps = {
  target: UserTarget | null;
  refreshKey?: number;
};

function getApiErrorMessage(
  response: {
    error: { value: unknown } | null;
  },
  fallback: string,
) {
  if (
    response.error &&
    typeof response.error.value === "object" &&
    response.error.value &&
    "error" in response.error.value
  ) {
    return String(response.error.value.error);
  }

  return fallback;
}

export function HistoryTab({ target, refreshKey = 0 }: HistoryTabProps) {
  const [batches, setBatches] = useState<HistoryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renameBatch, setRenameBatch] = useState<HistoryBatch | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleteBatch, setDeleteBatch] = useState<HistoryBatch | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!target) {
      setBatches([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const response = await apiClient.api.history.get();

    if (response.error) {
      setError("Failed to load upload history");
      setBatches([]);
      setLoading(false);
      return;
    }

    const payload = response.data;
    if (!payload || "error" in payload) {
      const message =
        payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to load upload history";
      setError(message);
      setBatches([]);
      setLoading(false);
      return;
    }

    setBatches(payload.batches);
    setLoading(false);
  }, [target]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client fetch on target/refresh change
    void loadHistory();
  }, [loadHistory, refreshKey]);

  async function copyBatch(batch: HistoryBatch) {
    const { error: clipboardError } = await tryCatch(
      navigator.clipboard.writeText(batch.copyPayload),
    );

    if (clipboardError) {
      toast.error("Could not copy URLs to your clipboard");
      return;
    }

    toast.success(
      batch.itemCount === 1
        ? "Copied public URL"
        : `Copied ${batch.itemCount} URLs`,
    );
  }

  function openRename(batch: HistoryBatch) {
    setRenameBatch(batch);
    setRenameValue(batch.name);
    setRenameError(null);
  }

  function closeRename() {
    if (renaming) {
      return;
    }
    setRenameBatch(null);
    setRenameValue("");
    setRenameError(null);
  }

  async function submitRename() {
    if (!renameBatch) {
      return;
    }

    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Give this upload a name");
      return;
    }
    if (trimmed.length > 100) {
      setRenameError("Name must be 100 characters or fewer");
      return;
    }

    setRenaming(true);
    setRenameError(null);

    const response = await apiClient.api.history({ id: renameBatch.id }).patch({
      name: trimmed,
    });

    setRenaming(false);

    if (response.error) {
      setRenameError(getApiErrorMessage(response, "Failed to rename upload"));
      return;
    }

    const payload = response.data;
    if (!payload || !("batch" in payload) || !payload.batch) {
      setRenameError("Failed to rename upload");
      return;
    }

    setBatches((current) =>
      current.map((batch) =>
        batch.id === payload.batch.id ? payload.batch : batch,
      ),
    );
    setRenameBatch(null);
    setRenameValue("");
    toast.success("Upload renamed");
  }

  async function confirmDelete() {
    if (!deleteBatch) {
      return;
    }

    setDeleting(true);

    const response = await apiClient.api
      .history({ id: deleteBatch.id })
      .delete();

    setDeleting(false);

    if (response.error) {
      toast.error(getApiErrorMessage(response, "Failed to delete upload"));
      return;
    }

    const payload = response.data;
    if (!payload || !("deleted" in payload) || !payload.deleted) {
      toast.error("Failed to delete upload");
      return;
    }

    const deletedId = deleteBatch.id;
    setBatches((current) => current.filter((batch) => batch.id !== deletedId));
    setDeleteBatch(null);
    toast.success(
      deleteBatch.itemCount === 1
        ? "Deleted file from R2 and history"
        : `Deleted ${deleteBatch.itemCount} files from R2 and history`,
    );
  }

  if (!target) {
    return (
      <MessagePanel
        title={COPY.noTarget.title}
        description={COPY.noTarget.description}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <MessagePanel
        title="History unavailable"
        description={error}
        variant="destructive"
      />
    );
  }

  if (batches.length === 0) {
    return (
      <MessagePanel
        title={COPY.historyEmpty.title}
        description={COPY.historyEmpty.description}
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        {batches.map((batch) => (
          <div
            key={batch.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">{batch.name}</p>
              <p className="text-xs text-muted-foreground">
                {batch.itemCount === 1 ? "1 file" : `${batch.itemCount} files`}{" "}
                · {new Date(batch.createdAt).toLocaleString()}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {batch.items.map((item) => item.key).join(", ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyBatch(batch)}
              >
                <CopyIcon data-icon="inline-start" />
                Copy URL{batch.itemCount === 1 ? "" : "s"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openRename(batch)}
              >
                <PencilIcon data-icon="inline-start" />
                Rename
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteBatch(batch)}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={renameBatch !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeRename();
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Rename upload</DialogTitle>
            <DialogDescription>
              This name only appears in History. Files in R2 are unchanged.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="history-batch-name">Upload name</Label>
            <Input
              id="history-batch-name"
              value={renameValue}
              autoFocus
              maxLength={100}
              disabled={renaming}
              onChange={(event) => {
                setRenameValue(event.target.value);
                if (renameError) {
                  setRenameError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitRename();
                }
              }}
            />
            {renameError ? (
              <p className="text-xs text-destructive">{renameError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={renaming} onClick={closeRename}>
              Cancel
            </Button>
            <Button disabled={renaming} onClick={() => void submitRename()}>
              {renaming ? <Spinner className="mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteBatch !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteBatch(null);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete upload?</DialogTitle>
            <DialogDescription>
              {deleteBatch
                ? deleteBatch.itemCount === 1
                  ? `This permanently deletes “${deleteBatch.name}” from History and removes the file from your R2 bucket.`
                  : `This permanently deletes “${deleteBatch.name}” from History and removes all ${deleteBatch.itemCount} files from your R2 bucket.`
                : null}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteBatch(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? <Spinner className="mr-2" /> : null}
              Delete from R2
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
