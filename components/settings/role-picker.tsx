import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@/lib/roles";

export { formatRole, type Role } from "@/lib/roles";

interface RolePickerProps {
  value: Role;
  onValueChange: (role: Role) => void;
  className?: string;
}

export function RolePicker({ value, onValueChange, className }: RolePickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as Role)}>
      <SelectTrigger className={className ?? "w-40"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sales">Sales</SelectItem>
        <SelectItem value="product_manager">Product Manager</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
