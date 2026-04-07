"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogConfig {
  title: string;
  description: string;
  confirm: string;
  destructive?: boolean;
}

interface ConfirmDialogProps {
  /** Pass null to hide the dialog; pass a config object to show it. */
  config: ConfirmDialogConfig | null;
  /** Whether the confirm action is in progress (shows spinner, disables buttons). */
  isActing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation dialog built on shadcn Dialog.
 *
 * Supports destructive and non-destructive variants, a loading spinner
 * during async confirmation, and auto-hides when `config` is null.
 */
export function ConfirmDialog({
  config,
  isActing,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!config) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isActing}>
            Cancel
          </Button>
          <Button
            variant={config.destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={isActing}
          >
            {isActing && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {isActing ? "Processing..." : config.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
