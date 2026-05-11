import { z } from "zod";

export const ROLE_VALUES = ["admin", "sales", "product_manager"] as const;

export type Role = (typeof ROLE_VALUES)[number];

export const roleSchema = z.enum(ROLE_VALUES, {
  error: `Role must be one of: ${ROLE_VALUES.join(", ")}`,
});

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  sales: "Sales",
  product_manager: "Product Manager",
};

export function formatRole(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}
