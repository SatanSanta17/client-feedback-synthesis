"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";
import type { Role } from "@/components/settings/role-picker";

interface Invitation {
  id: string;
  email: string;
  role: Role;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

interface PendingInvitationsTableProps {
  teamId: string;
  refreshKey: number;
}

function getInviteStatus(inv: Invitation): "pending" | "expired" {
  if (new Date(inv.expires_at) < new Date()) return "expired";
  return "pending";
}

export function PendingInvitationsTable({
  teamId,
  refreshKey,
}: PendingInvitationsTableProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`);
      if (!res.ok) throw new Error("Failed to load invitations");
      const data = await res.json();
      setInvitations(data.invitations ?? []);
    } catch (err) {
      console.error("Failed to fetch invitations:", err);
      toast.error("Could not load invitations");
    } finally {
      setIsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations, refreshKey]);

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

  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          Pending Invitations
        </h3>
        <p className="text-sm text-[var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">
        Pending Invitations
      </h3>

      {invitations.length === 0 ? (
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
  );
}
