import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Role = "admin" | "sales";

interface RolePickerProps {
  value: Role;
  onValueChange: (role: Role) => void;
  className?: string;
}

export function RolePicker({ value, onValueChange, className }: RolePickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as Role)}>
      <SelectTrigger className={className ?? "w-28"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sales">Sales</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
