"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function setActiveTeamCookie(teamId: string) {
  document.cookie = `active_team_id=${teamId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function CreateTeamDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Team name is required");
      return;
    }

    setIsCreating(true);

    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const msg = errorData?.message ?? "Failed to create team";
        toast.error(msg);
        return;
      }

      const { team } = await response.json();
      setActiveTeamCookie(team.id);
      toast.success(`Team "${team.name}" created`);
      setOpen(false);
      setName("");
      window.location.reload();
    } catch (err) {
      console.error("Create team error:", err);
      toast.error("Something went wrong");
    } finally {
      setIsCreating(false);
    }
  }, [name]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus data-icon="inline-start" />
          Create Team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Team</DialogTitle>
          <DialogDescription>
            Create a shared workspace where your team can capture sessions
            and build master signals together.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="team-name">Team name</Label>
          <Input
            id="team-name"
            placeholder="e.g. Product Team"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isCreating) handleCreate();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !name.trim()}
          >
            {isCreating ? "Creating…" : "Create Team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
