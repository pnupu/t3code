import { describe, expect, it } from "vite-plus/test";

import { shownHiddenList } from "./pendingHiddenPullRequests";

describe("hidden pull request saves", () => {
  const stored = ["https://h/a/1"];
  const saved = ["https://h/a/1", "https://h/a/2"];

  it("keeps a successful save until the subscription replaces the stored list", () => {
    expect(shownHiddenList(stored, { list: saved })).toBe(saved);
    expect(shownHiddenList(stored, { list: saved, savedOver: stored })).toBe(saved);
    // An unrelated settings update rebuilds the stored array with the old contents.
    expect(shownHiddenList([...stored], { list: saved, savedOver: stored })).toBe(saved);
    const echoed = [...saved];
    expect(shownHiddenList(echoed, { list: saved, savedOver: stored })).toBe(echoed);
  });
});
