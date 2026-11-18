import { describe, expect, it } from "vite-plus/test";

import { settledHiddenSaves, shownHiddenList } from "./pendingHiddenPullRequests";

describe("hidden pull request saves", () => {
  const stored = ["https://h/a/1"];
  const saved = ["https://h/a/1", "https://h/a/2"];
  const save = { list: saved, sentOver: stored };

  it("keeps a save until the stored list changes, even when settings re-emit unchanged", () => {
    expect(shownHiddenList(stored, save)).toBe(saved);
    expect(shownHiddenList([...stored], save)).toBe(saved);
    expect(settledHiddenSaves(new Map([["env-1", save]]), () => [...stored])).toEqual([]);
  });

  it("ends a save at the next update, so another client's unhide is not undone", () => {
    // The save's echo arrives, then another client unhides back to the original contents.
    expect(settledHiddenSaves(new Map([["env-1", save]]), () => saved)).toEqual(["env-1"]);
    expect(shownHiddenList([...stored], undefined)).toEqual(stored);
  });
});
