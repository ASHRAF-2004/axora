import { Brand } from "@/components/Brand";
import { LoaderCircle } from "lucide-react";

export function RouteLoadingScreen({
  message = "Loading Axora…",
}: {
  message?: string;
}) {
  return (
    <div className="route-loading-screen" role="status" aria-live="polite">
      <div className="route-loading-card">
        <Brand />
        <LoaderCircle className="ux-spin" size={32} />
        <strong>{message}</strong>
        <p>Please wait while Axora prepares the next screen.</p>
      </div>
    </div>
  );
}
