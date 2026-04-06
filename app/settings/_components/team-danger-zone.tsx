"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearActiveTeamCookie } from "@/lib/cookies/active-team";

interface TeamDangerZoneProps {
  teamId: string;
  teamName: string;
  isOwner: boolean;
  onTeamRenamed: (newName: string) => void;
  onTeamDeleted: () => void;
}

export function TeamDangerZone({
  teamId,
  teamName,
  isOwner,
  onTeamRenamed,
  onTeamDeleted,
}: TeamDangerZoneProps) {
  const [newName, setNewName] = useState(teamName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  if (!isOwner) return null;

  const nameChanged = newName.trim() !== teamName && newName.trim().length > 0;
  const deleteConfirmed = deleteConfirmText === teamName;

  async function handleRename() {
    setIsRenaming(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to rename team");
      }
      const data = await res.json();
      toast.success("Team renamed");
      onTeamRenamed(data.team.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to delete team");
      }
      toast.success("Team deleted");
      clearActiveTeamCookie();
      onTeamDeleted();
      router.push("/capture");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  return (
    <>
      <div className="space-y-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">
              Team Name
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 text-sm"
              maxLength={100}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRename}
            disabled={!nameChanged || isRenaming}
          >
            {isRenaming ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Pencil className="mr-1.5 size-3.5" />
            )}
            {isRenaming ? "Renaming..." : "Rename"}
          </Button>
        </div>

        <div className="flex items-center justify-between border-t border-destructive/20 pt-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Delete Team
            </p>
            <p className="text-xs text-muted-foreground">
              All team data will become inaccessible. This cannot be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete Team
          </Button>
        </div>
      </div>

      <Dialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowDeleteDialog(false);
            setDeleteConfirmText("");
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete Team</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{teamName}</strong> and make
              all team data inaccessible. Type the team name below to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder={teamName}
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            className="mt-2"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setDeleteConfirmText("");
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!deleteConfirmed || isDeleting}
            >
              {isDeleting && (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              )}
              {isDeleting ? "Deleting..." : "Delete Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
