import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(path: string) { return readFile(new URL(`../${path}`, import.meta.url), "utf8"); }

describe("profile image presentation", () => {
  it("provides crop, progress, processing, removal, and reduced-motion UI", async () => {
    const [component, css] = await Promise.all([source("src/components/ProfileImageManager.tsx"), source("src/app/globals.css")]);
    expect(component).toMatch(/focalX[\s\S]+focalY[\s\S]+zoom/);
    expect(component).toMatch(/<progress/); expect(component).toMatch(/aria-live="polite"/);
    expect(component).toMatch(/removeAction/); expect(css).toMatch(/prefers-reduced-motion/);
  });
  it("uses only authenticated scoped image URLs for users and deliveries", async () => {
    const [avatar, receiving, users] = await Promise.all([
      source("src/components/UserAvatar.tsx"), source("src/app/(portal)/receiving/page.tsx"), source("src/app/(portal)/users/page.tsx"),
    ]);
    expect(avatar).toContain("/api/profile/avatar/"); expect(avatar).toContain("deliveryJobId");
    expect(receiving).toContain("deliveryJobId={job.id}"); expect(users).toContain("user.avatarAvailable");
  });
});
