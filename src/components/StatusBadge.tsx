import { statusTone } from "@/lib/domain";

export function StatusBadge({ children }: { children: string }) {
  return <span className={`status-badge status-${statusTone(children)}`}>{children}</span>;
}
