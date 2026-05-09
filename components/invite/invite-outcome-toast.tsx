"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

const MESSAGES: Record<string, { kind: "success" | "info"; text: string }> = {
  joined: { kind: "success", text: "You joined the team!" },
  already_member: {
    kind: "info",
    text: "You're already a member of this team.",
  },
};

/**
 * Reads `?invite_outcome=...` from the current URL once on mount, fires the
 * matching sonner toast, and strips the query parameter so a refresh doesn't
 * re-fire it. Mounted globally so any post-invite redirect destination
 * (`/dashboard`, `/capture`, ...) can carry the flash.
 */
export function InviteOutcomeToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const outcome = searchParams.get("invite_outcome");
    if (!outcome) return;

    const message = MESSAGES[outcome];
    if (message) {
      if (message.kind === "success") {
        toast.success(message.text);
      } else {
        toast.info(message.text);
      }
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("invite_outcome");
    window.history.replaceState({}, "", url.toString());
  }, [searchParams]);

  return null;
}
