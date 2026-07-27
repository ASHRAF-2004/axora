import { describe, expect, it } from "vitest";
import { encodeCsvCell } from "@/lib/csv";

describe("CSV spreadsheet safety", () => {
  it.each([
    ["=2+3", "'=2+3"],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-1+2", "'-1+2"],
    ["+3-1", "'+3-1"],
    ["-2*4", "'-2*4"],
    ["@SUM(1,1)", "\"'@SUM(1,1)\""],
    [" =HYPERLINK(\"https://example.test\")", "\"' =HYPERLINK(\"\"https://example.test\"\")\""],
    ["\t=1+1", "\"'\t=1+1\""],
    [" \t=1+1", "\"' \t=1+1\""],
    ["\r=1+1", "\"'\r=1+1\""],
  ])("neutralizes a dangerous formula prefix in %j", (input, expected) => {
    expect(encodeCsvCell(input)).toBe(expected);
  });

  it.each([
    "-5.00",
    "+3",
    ".5",
    "-.75",
    "+12.",
    "0",
  ])("keeps the plain number %s numeric", (input) => {
    expect(encodeCsvCell(input)).toBe(input);
  });

  it("retains regular data while escaping CSV structure characters", () => {
    expect(encodeCsvCell("Paper, A4")).toBe("\"Paper, A4\"");
    expect(encodeCsvCell("He said \"hello\"")).toBe("\"He said \"\"hello\"\"\"");
    expect(encodeCsvCell("ordinary value")).toBe("ordinary value");
    expect(encodeCsvCell(null)).toBe("");
  });
});
