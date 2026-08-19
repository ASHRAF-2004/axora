import { describe, expect, it } from "vitest";
import {
  immersivePublicCopy,
  PUBLIC_APPEARANCE_SCENES,
  WORKFLOW_STAGE_IDS,
} from "@/lib/immersive-public-experience";

describe("immersive public experience", () => {
  it("keeps one complete localized workflow in every supported locale", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = immersivePublicCopy(locale);
      expect(copy.stages.map((stage) => stage.id)).toEqual(WORKFLOW_STAGE_IDS);
      expect(copy.stages).toHaveLength(8);
      expect(copy.sections.howItems).toHaveLength(3);
      expect(copy.sections.roles).toHaveLength(3);
    }
  });

  it("does not expose obsolete or technical payment wording", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const serialized = JSON.stringify(immersivePublicCopy(locale));
      expect(serialized).not.toMatch(/\b(?:COD|OFFLINE|MANUAL|PHYSICAL)\b/);
    }
  });

  it("provides exactly Light and Dark procedural scene palettes", () => {
    expect(PUBLIC_APPEARANCE_SCENES.map((item) => item.id)).toEqual([
      "light", "dark",
    ]);
    for (const appearance of PUBLIC_APPEARANCE_SCENES) {
      expect(Object.values(appearance.scene)).toHaveLength(6);
      for (const value of Object.values(appearance.scene)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
