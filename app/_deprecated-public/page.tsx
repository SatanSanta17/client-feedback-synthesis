// DEPRECATED: This route group is unused. The landing page lives at app/page.tsx.
// These files can be safely deleted. They exist only because the file system
// did not allow deletion during the session.
import { redirect } from "next/navigation";
export default function DeprecatedPublicPage() { redirect("/"); }
