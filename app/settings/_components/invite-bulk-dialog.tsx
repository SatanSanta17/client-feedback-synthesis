"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Role = "admin" | "sales";

interface InviteBulkDialogProps {
  teamId: string;
  onInvitesSent: () => void;
}

export function InviteBulkDialog({ teamId, onInvitesSent }: InviteBulkDialogProps) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Role>("sales");
  const [isSending, setIsSending] = useState(false);

  async function handleSend() {
    const lines = emails
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      toast.error("Enter at least one email address");
      return;
    }

    setIsSending(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: lines, role }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.message ?? "Failed to send invites");
        return;
      }

      const data = await res.json();
      const sentCount = data.sent?.length ?? 0;
      const skippedCount = data.skipped?.length ?? 0;

      if (sentCount > 0) {
        toast.success(
          `${sentCount} invite${sentCount > 1 ? "s" : ""} sent` +
            (skippedCount > 0 ? `, ${skippedCount} skipped` : "")
        );
      } else if (skippedCount > 0) {
        toast.warning(`All ${skippedCount} email(s) were skipped`);
      }

      setOpen(false);
      setEmails("");
      onInvitesSent();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users data-icon="inline-start" className="size-3.5" />
          Bulk Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Invite</DialogTitle>
          <DialogDescription>
            Paste multiple email addresses separated by commas, semicolons, or
            new lines.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            placeholder={"alice@company.com\nbob@company.com\ncarol@company.com"}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            rows={5}
          />
          <div className="flex items-center gap-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSend}
            disabled={!emails.trim() || isSending}
          >
            {isSending ? "Sending…" : "Send All"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
