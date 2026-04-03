"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { InviteSingleForm } from "./invite-single-form";
import { InviteBulkDialog } from "./invite-bulk-dialog";
import { PendingInvitationsTable } from "./pending-invitations-table";
import { TeamMembersTable } from "./team-members-table";
import { TeamDangerZone } from "./team-danger-zone";

interface TeamSettingsProps {
  teamId: string;
  teamName: string;
  ownerId: string;
  isOwner: boolean;
  isAdmin: boolean;
}

export function TeamSettings({
  teamId,
  teamName: initialTeamName,
  ownerId,
  isOwner,
  isAdmin,
}: TeamSettingsProps) {
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [teamName, setTeamName] = useState(initialTeamName);

  const handleChange = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {teamName}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Manage members, invitations, and team settings.
        </p>
      </div>

      <TeamMembersTable
        teamId={teamId}
        ownerId={ownerId}
        currentUserId={user?.id ?? ""}
        isOwner={isOwner}
        isAdmin={isAdmin}
        refreshKey={refreshKey}
        onMemberChanged={handleChange}
      />

      <InviteSingleForm teamId={teamId} onInviteSent={handleChange} />

      <InviteBulkDialog teamId={teamId} onInvitesSent={handleChange} />

      <PendingInvitationsTable teamId={teamId} refreshKey={refreshKey} />

      <TeamDangerZone
        teamId={teamId}
        teamName={teamName}
        isOwner={isOwner}
        onTeamRenamed={(newName) => setTeamName(newName)}
        onTeamDeleted={handleChange}
      />
    </div>
  );
}
