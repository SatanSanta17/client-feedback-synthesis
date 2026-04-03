"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Send, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { formatRelativeTime } from "@/lib/utils/format-relative-time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = "admin" | "sales";

interface Invitation {
  id: string;
  email: string;
  role: Role;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface TeamSettingsProps {
  teamId: string;
  teamName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamSettings({ teamId, teamName }: TeamSettingsProps) {
  // Single invite
  const [singleEmail, setSingleEmail] = useState("");
  const [singleRole, setSingleRole] = useState<Role>("sales");
  const [isSendingSingle, setIsSendingSingle] = useState(false);

  // Bulk invite
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEmails, setBulkEmails] = useState("");
  const [bulkRole, setBulkRole] = useState<Role>("sales");
  const [isSendingBulk, setIsSendingBulk] = useState(false);

  // Pending invitations
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Fetch invitations
  // -------------------------------------------------------------------------

  const fetchInvitations = useCallback(async () => {
    setIsLoadingInvites(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`);
      if (!res.ok) throw new Error("Failed to load invitations");
      const data = await res.json();
      setInvitations(data.invitations ?? []);
    } catch (err) {
      console.error("Failed to fetch invitations:", err);
      toast.error("Could not load invitations");
    } finally {
      setIsLoadingInvites(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  // -------------------------------------------------------------------------
  // Single invite
  // -------------------------------------------------------------------------

  async function handleSingleInvite() {
    const email = singleEmail.trim();
    if (!email) return;

    setIsSendingSingle(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: [email], role: singleRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.message ?? "Failed to send invite");
        return;
      }

      const data = await res.json();
      if (data.sent?.length > 0) {
        toast.success(`Invitation sent to ${email}`);
        setSingleEmail("");
      } else if (data.skipped?.length > 0) {
        toast.warning(
          `${email}: ${data.skipped[0].reason}`
        );
      }
      await fetchInvitations();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSendingSingle(false);
    }
  }

  // -------------------------------------------------------------------------
  // Bulk invite
  // -------------------------------------------------------------------------

  async function handleBulkInvite() {
    const lines = bulkEmails
      .split(/[\n,;]+/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      toast.error("Enter at least one email address");
      return;
    }

    setIsSendingBulk(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: lines, role: bulkRole }),
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

      setBulkOpen(false);
      setBulkEmails("");
      await fetchInvitations();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSendingBulk(false);
    }
  }

  // -------------------------------------------------------------------------
  // Revoke
  // -------------------------------------------------------------------------

  async function handleRevoke(invitationId: string) {
    setActionInFlight(invitationId);
    try {
      const res = await fetch(
        `/api/teams/${teamId}/invitations/${invitationId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to revoke");
      toast.success("Invitation revoked");
      await fetchInvitations();
    } catch {
      toast.error("Failed to revoke invitation");
    } finally {
      setActionInFlight(null);
    }
  }

  // -------------------------------------------------------------------------
  // Resend
  // -------------------------------------------------------------------------

  async function handleResend(invitationId: string) {
    setActionInFlight(invitationId);
    try {
      const res = await fetch(
        `/api/teams/${teamId}/invitations/${invitationId}/resend`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("Failed to resend");
      toast.success("Invitation resent");
      await fetchInvitations();
    } catch {
      toast.error("Failed to resend invitation");
    } finally {
      setActionInFlight(null);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function getInviteStatus(inv: Invitation): "pending" | "expired" {
    if (new Date(inv.expires_at) < new Date()) return "expired";
    return "pending";
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {teamName}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Invite members and manage pending invitations.
        </p>
      </div>

      {/* Single Invite */}
      <div className="space-y-3">
        <Label>Invite a member</Label>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isSendingSingle) handleSingleInvite();
              }}
            />
          </div>
          <Select
            value={singleRole}
            onValueChange={(v) => setSingleRole(v as Role)}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            onClick={handleSingleInvite}
            disabled={!singleEmail.trim() || isSendingSingle}
          >
            <Send data-icon="inline-start" className="size-3.5" />
            {isSendingSingle ? "Sending…" : "Send Invite"}
          </Button>
        </div>
      </div>

      {/* Bulk Invite Button */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
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
              value={bulkEmails}
              onChange={(e) => setBulkEmails(e.target.value)}
              rows={5}
            />
            <div className="flex items-center gap-2">
              <Label>Role</Label>
              <Select
                value={bulkRole}
                onValueChange={(v) => setBulkRole(v as Role)}
              >
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
              onClick={handleBulkInvite}
              disabled={!bulkEmails.trim() || isSendingBulk}
            >
              {isSendingBulk ? "Sending…" : "Send All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending Invitations */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Pending Invitations
        </h3>

        {isLoadingInvites ? (
          <p className="text-sm text-[var(--text-muted)]">Loading…</p>
        ) : invitations.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No pending invitations.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] bg-[var(--surface-raised)]">
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Email
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Role
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-[var(--text-secondary)]">
                    Sent
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-[var(--text-secondary)]">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => {
                  const status = getInviteStatus(inv);
                  const isBusy = actionInFlight === inv.id;

                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-[var(--border-default)] last:border-0"
                    >
                      <td className="px-3 py-2 text-[var(--text-primary)]">
                        {inv.email}
                      </td>
                      <td className="px-3 py-2 capitalize text-[var(--text-secondary)]">
                        {inv.role}
                      </td>
                      <td className="px-3 py-2">
                        {status === "expired" ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : (
                          <Badge variant="secondary">Pending</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-muted)]">
                        {formatRelativeTime(inv.created_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Resend"
                            onClick={() => handleResend(inv.id)}
                            disabled={isBusy}
                          >
                            <RotateCw className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Revoke"
                            onClick={() => handleRevoke(inv.id)}
                            disabled={isBusy}
                          >
                            <Trash2 className="size-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
