"use client"

import { Loader2, Save, X, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface ExpandedSessionActionsProps {
  canEdit: boolean
  isFormValid: boolean
  isDirty: boolean
  isSaving: boolean
  isDeleting: boolean
  isOverLimit: boolean
  showDeleteConfirm: boolean
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onShowDeleteConfirm: (show: boolean) => void
}

export function ExpandedSessionActions({
  canEdit,
  isFormValid,
  isDirty,
  isSaving,
  isDeleting,
  isOverLimit,
  showDeleteConfirm,
  onSave,
  onCancel,
  onDelete,
  onShowDeleteConfirm,
}: ExpandedSessionActionsProps) {
  if (!canEdit) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
        >
          <X className="mr-1.5 size-3.5" />
          Close
        </Button>
        <span className="text-xs text-muted-foreground">
          View only — you can only edit your own sessions
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={onSave}
        disabled={!isFormValid || !isDirty || isSaving || isDeleting || isOverLimit}
      >
        {isSaving ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <Save className="mr-1.5 size-3.5" />
        )}
        {isSaving ? "Saving..." : "Save"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onCancel}
        disabled={isSaving || isDeleting}
      >
        <X className="mr-1.5 size-3.5" />
        Cancel
      </Button>

      <div className="ml-auto">
        {showDeleteConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Delete this session?
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
            >
              {isDeleting && (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              )}
              {isDeleting ? "Deleting..." : "Confirm"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onShowDeleteConfirm(false)}
              disabled={isDeleting}
            >
              No
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onShowDeleteConfirm(true)}
            disabled={isSaving || isDeleting}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
