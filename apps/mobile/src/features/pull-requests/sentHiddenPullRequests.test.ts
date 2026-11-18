import { describe, expect, it } from "vite-plus/test";

import { sentHiddenPullRequestApplies } from "./sentHiddenPullRequests";

describe("a hide sent from this device", () => {
  it("shows while in flight and after the reply, until the settings push arrives", () => {
    const before = { hiddenPullRequests: {} };
    const sent = { url: "https://h/a/1" };
    expect(sentHiddenPullRequestApplies(sent, () => before)).toBe(true);
    const saved = { ...sent, settledOver: new Map([["env-1", before]]) };
    // The reply came first: the environment still holds the settings it had.
    expect(sentHiddenPullRequestApplies(saved, () => before)).toBe(true);
    expect(sentHiddenPullRequestApplies(saved, () => ({ hiddenPullRequests: {} }))).toBe(false);
  });
});
