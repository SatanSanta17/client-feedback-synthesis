"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Crown, LogOut, UserMinus, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dialog";

interface MemberEntry {
  user_id: string;
  email: string;
  role: string;
  joined_at: string;
}

interface TeamMembersTableProps {
  teamId: string;
  ownerId: string;
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
  refreshKey: number;
  onMemberChanged: () => void;
}

type ConfirmAction =
  | { type: "remove"; member: MemberEntry }
  | { type: "transfer"; member: MemberEntry }
  | { type: "leave" };

function clearActiveTeamCookie() {
  document.cookie = "active_team_id=; path=/; max-age=0; SameSite=Lax";
}

export function TeamMembersTable({
  teamId,
  ownerId,
  currentUserId,
  isOwner,
  isAdmin,
  refreshKey,
  onMemberChanged,
}: TeamMembersTableProps) {
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [isActing, setIsActing] = useState(false);
  const router = useRouter();

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members`);
      if (!res.ok) throw new Error("Failed to fetch members");
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch (err) {
      console.error("[TeamMembersTable] fetch error:", err);
      toast.error("Failed to load team members");
    } finally {
      setIsLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers, refreshKey]);

  const hasOtherAdmins = members.some(
    (m) => m.role === "admin" && m.user_id !== currentUserId
  );

  async function handleRemove(member: MemberEntry) {
    setIsActing(true);
    try {
      const res = await fetch(
        `/api/teams/${teamId}/members/${member.user_id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to remove member");
      }
      toast.success(`Removed ${member.email} from the team`);
      onMemberChanged();
      await fetchMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsActing(false);
      setConfirmAction(null);
    }
  }

  async function handleTransfer(member: MemberEntry) {
    setIsActing(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId: member.user_id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to transfer ownership");
      }
      toast.success(`Ownership transferred to ${member.email}`);
      onMemberChanged();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsActing(false);
      setConfirmAction(null);
    }
  }

  async function handleLeave() {
    setIsActing(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/leave`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to leave team");
      }
      toast.success("You have left the team");
      clearActiveTeamCookie();
      router.push("/capture");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsActing(false);
      setConfirmAction(null);
    }
  }

  async function handleRoleChange(member: MemberEntry, newRole: string) {
    try {
      const res = await fetch(
        `/api/teams/${teamId}/members/${member.user_id}/role`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to change role");
      }
      toast.success(`Changed ${member.email} to ${newRole}`);
      onMemberChanged();
      await fetchMembers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  function confirmRemove(member: MemberEntry) {
    setConfirmAction({ type: "remove", member });
  }

  function confirmTransfer(member: MemberEntry) {
    setConfirmAction({ type: "transfer", member });
  }

  function confirmLeave() {
    setConfirmAction({ type: "leave" });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Members ({members.length})
        </h3>
        <div className="mt-2 overflow-hidden rounded-lg border border-[var(--border-default)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Email
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Role
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Joined
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.user_id === currentUserId;
                const isMemberOwner = member.user_id === ownerId;

                return (
                  <tr
                    key={member.user_id}
                    className="border-b last:border-b-0"
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {member.email}
                      {isSelf && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {isMemberOwner && (
                          <Badge
                            variant="default"
                            className="gap-1 text-xs"
                          >
                            <Crown className="size-2.5" />
                            Owner
                          </Badge>
                        )}
                        {isOwner && !isSelf && !isMemberOwner ? (
                          <Select
                            value={member.role}
                            onValueChange={(val) =>
                              handleRoleChange(member, val)
                            }
                          >
                            <SelectTrigger className="h-7 w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="sales">Sales</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          !isMemberOwner && (
                            <Badge variant="secondary" className="capitalize text-xs">
                              {member.role}
                            </Badge>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {new Date(member.joined_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {isSelf ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={confirmLeave}
                            disabled={isOwner && !hasOtherAdmins}
                            title={
                              isOwner && !hasOtherAdmins
                                ? "Promote another member to admin before leaving"
                                : undefined
                            }
                          >
                            <LogOut className="mr-1 size-3" />
                            Leave
                          </Button>
                        ) : (
                          <>
                            {isOwner && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => confirmTransfer(member)}
                              >
                                <ArrowRightLeft className="mr-1 size-3" />
                                Transfer
                              </Button>
                            )}
                            {(isOwner ||
                              (isAdmin && member.role === "sales")) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => confirmRemove(member)}
                              >
                                <UserMinus className="mr-1 size-3" />
                                Remove
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        action={confirmAction}
        isActing={isActing}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === "remove") handleRemove(confirmAction.member);
          if (confirmAction.type === "transfer") handleTransfer(confirmAction.member);
          if (confirmAction.type === "leave") handleLeave();
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}

function ConfirmDialog({
  action,
  isActing,
  onConfirm,
  onCancel,
}: {
  action: ConfirmAction | null;
  isActing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!action) return null;

  const config = {
    remove: {
      title: "Remove Member",
      description: `Remove ${action.type === "remove" ? action.member.email : ""} from the team? Their existing data will remain with the team.`,
      confirm: "Remove",
      destructive: true,
    },
    transfer: {
      title: "Transfer Ownership",
      description: `Transfer ownership to ${action.type === "transfer" ? action.member.email : ""}? You will remain as an admin.`,
      confirm: "Transfer",
      destructive: false,
    },
    leave: {
      title: "Leave Team",
      description:
        "Are you sure you want to leave this team? You will lose access to team data.",
      confirm: "Leave",
      destructive: true,
    },
  }[action.type];

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
