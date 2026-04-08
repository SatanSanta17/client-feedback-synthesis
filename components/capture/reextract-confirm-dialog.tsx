import { Button } from "@/components/ui/button"

interface ReextractConfirmDialogProps {
  show: boolean
  /** When true, warns the user that their manual edits to structured notes will be lost. */
  hasManualEdits?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ReextractConfirmDialog({
  show,
  hasManualEdits = false,
  onConfirm,
  onCancel,
}: ReextractConfirmDialogProps) {
  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
        <h3 className="text-base font-semibold text-foreground">
          Re-extract Signals?
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasManualEdits
            ? "You\u2019ve manually edited the structured notes since the last extraction. Re-extracting will replace your edits. Continue?"
            : "Re-extracting will replace your edited signals. Continue?"}
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onConfirm}>
            Re-extract
          </Button>
        </div>
      </div>
    </div>
  )
}
