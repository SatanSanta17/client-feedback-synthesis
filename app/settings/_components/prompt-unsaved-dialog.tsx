"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface PromptUnsavedDialogProps {
  open: boolean
  onStay: () => void
  onDiscard: () => void
}

export function PromptUnsavedDialog({
  open,
  onStay,
  onDiscard,
}: PromptUnsavedDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onStay()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Unsaved Changes</DialogTitle>
          <DialogDescription>
            You have unsaved changes to this prompt. Do you want to discard
            them and switch tabs?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onStay}>
            Stay
          </Button>
          <Button variant="outline" onClick={onDiscard}>
            Discard &amp; Switch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
