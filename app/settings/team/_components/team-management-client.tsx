"use client";

import { useState, useCallback } from "react";
import { InviteSingleForm } from "@/app/settings/_components/invite-single-form";
import { InviteBulkDialog } from "@/app/settings/_components/invite-bulk-dialog";
import { PendingInvitationsTable } from "@/app/settings/_components/pending-invitations-table";
import { TeamMembersTable } from "@/app/settings/_components/team-members-table";
import { TeamDangerZone } from "@/app/settings/_components/team-danger-zone";

interface TeamManagementClientProps {
  teamId: string;
  teamName: string;
  ownerId: string;
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
}

export function TeamManagementClient({
  teamId,
  teamName: initialTeamName,
  ownerId,
  currentUserId,
  isOwner,
  isAdmin,
}: TeamManagementClientProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [teamName, setTeamName] = useState(initialTeamName);

  const handleChange = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-[var(--text-secondary)]">
          You are a member of this team. Only admins can manage invitations and settings.
        </p>
        <TeamMembersTable
          teamId={teamId}
          ownerId={ownerId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          isAdmin={isAdmin}
          refreshKey={refreshKey}
          onMemberChanged={handleChange}
        />
      </div>
    );
  }

  return (
    <>
      <section className="mt-8 space-y-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Access</h2>
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
          <InviteSingleForm teamId={teamId} onInviteSent={handleChange} />
          <InviteBulkDialog teamId={teamId} onInvitesSent={handleChange} />
        </div>
        <PendingInvitationsTable teamId={teamId} refreshKey={refreshKey} />
        <TeamMembersTable
          teamId={teamId}
          ownerId={ownerId}
          currentUserId={currentUserId}
          isOwner={isOwner}
          isAdmin={isAdmin}
          refreshKey={refreshKey}
          onMemberChanged={handleChange}
        />
      </section>

      {isOwner && (
        <section className="mt-12 space-y-6 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Manage Team</h2>
          <TeamDangerZone
            teamId={teamId}
            teamName={teamName}
            isOwner={isOwner}
            onTeamRenamed={setTeamName}
            onTeamDeleted={handleChange}
          />
        </section>
      )}
    </>
  );
}
