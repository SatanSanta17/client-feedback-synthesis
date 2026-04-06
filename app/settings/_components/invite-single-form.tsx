"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RolePicker, type Role } from "@/components/settings/role-picker";

interface InviteSingleFormProps {
  teamId: string;
  onInviteSent: () => void;
}

export function InviteSingleForm({ teamId, onInviteSent }: InviteSingleFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("sales");
  const [isSending, setIsSending] = useState(false);

  async function handleSend() {
    const trimmed = email.trim();
    if (!trimmed) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: [trimmed], role }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.message ?? "Failed to send invite");
        return;
      }

      const data = await res.json();
      if (data.sent?.length > 0) {
        toast.success(`Invitation sent to ${trimmed}`);
        setEmail("");
      } else if (data.skipped?.length > 0) {
        toast.warning(`${trimmed}: ${data.skipped[0].reason}`);
      }
      onInviteSent();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Label>Invite a member</Label>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            type="email"
            placeholder="colleague@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isSending) handleSend();
            }}
          />
        </div>
        <RolePicker value={role} onValueChange={setRole} />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!email.trim() || isSending}
        >
          <Send data-icon="inline-start" className="size-3.5" />
          {isSending ? "Sending…" : "Send Invite"}
        </Button>
      </div>
    </div>
  );
}
