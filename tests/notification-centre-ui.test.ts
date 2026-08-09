import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

const readSource=(path:string)=>readFileSync(join(process.cwd(),path),"utf8");

describe("notification centre presentation contract",()=>{
  it("keeps the inbox, filters, preference controls and safe route action in one page",()=>{
    const page=readSource("src/app/(portal)/notifications/page.tsx");

    expect(page).toContain("notification-centre");
    expect(page).toContain("notification-filter-bar");
    expect(page).toContain("notification-preferences");
    expect(page).toContain('name="category"');
    expect(page).toContain('name="status"');
    expect(page).toContain("notification.routePath");
    expect(page).toContain("markAllNotificationsReadAction");
    expect(page).toContain("archiveNotificationAction");
  });

  it("ships English, Arabic and Malay notification-centre copy",()=>{
    const copy=readSource("src/lib/notification-centre-i18n.ts");

    expect(copy).toContain("Notification centre");
    expect(copy).toMatch(/[\u0600-\u06ff]/u);
    expect(copy).toContain("ms:");
    expect(copy).toContain("always");
  });

  it("uses logical, mobile, RTL and reduced-motion notification styles",()=>{
    const css=readSource("src/app/globals.css");

    expect(css).toContain(".notification-centre");
    expect(css).toMatch(/margin-inline|padding-inline|inset-inline/u);
    expect(css).toMatch(/\[dir=["']rtl["']\][\s\S]*notification/u);
    expect(css).toMatch(/@media\s*\(max-width:\s*\d+px\)[\s\S]*notification/u);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*notification/u);
  });
});
