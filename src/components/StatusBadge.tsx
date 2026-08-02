import { statusTone } from "@/lib/domain";

export function StatusBadge({ children, status }: { children: string; status?: string }) {
  return <span className={`status-badge status-${statusTone(status ?? children)}`}>{children}</span>;
}
