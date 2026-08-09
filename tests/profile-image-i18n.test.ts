import { describe, expect, it } from "vitest";
import { profileImageMessages } from "@/lib/profile-image-i18n";

describe("profile image localization", () => {
  it.each(["en", "ar", "ms"] as const)("has complete %s lifecycle and policy copy", (locale) => {
    const copy = profileImageMessages(locale);
    expect(copy.title).toBeTruthy(); expect(copy.help).toBeTruthy();
    expect(copy.settingsTitle).toBeTruthy(); expect(copy.assignedAgent).toBeTruthy();
    expect(Object.keys(copy.errors).sort()).toEqual([
      "decode", "dimensions", "interrupted", "processing", "size", "storage", "transparent", "type", "unavailable",
    ]);
  });
});
