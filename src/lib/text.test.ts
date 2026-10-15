import { describe, expect, it } from "vitest";
import { oneLine, plain, plural } from "./text";

describe("text helpers", () => {
  it("plural says 1 unit, 2 units", () => {
    expect(plural(1, "unit")).toBe("1 unit");
    expect(plural(2, "unit")).toBe("2 units");
    expect(plural(0, "piece")).toBe("0 pieces");
    expect(plural(3, "person", "people")).toBe("3 people");
  });

  it("plain drops markdown marks and turns list dashes into bullets", () => {
    expect(plain("What I found:\n- **Payment:** none\n## Next\n`x`")).toBe("What I found:\n• Payment: none\nNext\nx");
  });

  it("oneLine keeps the first paragraph and cuts it", () => {
    expect(oneLine("First **bold** line\nsame paragraph\n\nSecond")).toBe("First bold line same paragraph");
    expect(oneLine("x".repeat(300), 20)).toBe(`${"x".repeat(19)}…`);
  });
});
