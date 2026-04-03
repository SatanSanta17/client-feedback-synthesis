"use client";

import { useCallback, useState } from "react";
import { InviteSingleForm } from "./invite-single-form";
import { InviteBulkDialog } from "./invite-bulk-dialog";
import { PendingInvitationsTable } from "./pending-invitations-table";

interface TeamSettingsProps {
  teamId: string;
  teamName: string;
}

export function TeamSettings({ teamId, teamName }: TeamSettingsProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleInviteSent = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {teamName}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Invite members and manage pending invitations.
        </p>
      </div>

      <InviteSingleForm teamId={teamId} onInviteSent={handleInviteSent} />

      <InviteBulkDialog teamId={teamId} onInvitesSent={handleInviteSent} />

      <PendingInvitationsTable teamId={teamId} refreshKey={refreshKey} />
    </div>
  );
}
