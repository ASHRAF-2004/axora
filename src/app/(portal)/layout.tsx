import { logoutAction } from "@/app/actions";
import { Sidebar } from "@/components/Sidebar";
import { requireSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { Bell, LogOut } from "lucide-react";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  return (
    <div className="portal-shell">
      <Sidebar role={user.role} />
      <div className="portal-main">
        <header className="topbar">
          <div><span className={`environment-dot ${isDemoMode() ? "environment-demo" : "environment-live"}`} />{isDemoMode() ? "Safe sample data" : "Axora production"}</div>
          <div className="topbar-actions">
            <button className="icon-button" type="button" aria-label="Notifications"><Bell size={19} /></button>
            <div className="user-summary"><span>{user.name}</span><small>{user.role.replace("_", " ")}</small></div>
            <form action={logoutAction}><button className="icon-button" type="submit" aria-label="Sign out"><LogOut size={19} /></button></form>
          </div>
        </header>
        <main className="content-shell">{children}</main>
      </div>
    </div>
  );
}
