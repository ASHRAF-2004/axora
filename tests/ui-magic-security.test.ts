import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("accessible interaction and first-login safeguards", () => {
  it("keeps pointer effects decorative and provides coarse-pointer and reduced-motion fallbacks", async () => {
    const [component, css] = await Promise.all([
      source("../src/components/InteractionMagic.tsx"),
      source("../src/app/interaction-magic.css"),
    ]);
    expect(component).toContain("prefers-reduced-motion: reduce");
    expect(component).toContain("pointer: fine");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("@media (pointer: coarse)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toMatch(/cursor\s*:\s*none/i);
  });

  it("requires the submitted first-login team to match the live authorized assignment", async () => {
    const [page, action] = await Promise.all([
      source("../src/app/(portal)/profile/page.tsx"),
      source("../src/app/(portal)/profile/actions.ts"),
    ]);
    expect(page).toContain('name="assignedTeam"');
    expect(page).toContain("actor.roleAssignmentId ?? actor.role");
    expect(page).toContain('role="dialog"');
    expect(page).toContain('aria-modal="true"');
    expect(page).toContain('data-photo-required=');
    expect(action).toContain('assignedTeam !== (actor.roleAssignmentId ?? actor.role)');
  });
});
