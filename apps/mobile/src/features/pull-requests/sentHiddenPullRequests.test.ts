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

  it("shows an unhide across two holders until both have pushed", () => {
    const a = { hiddenPullRequests: {} };
    const b = { hiddenPullRequests: {} };
    const sent = {
      url: null,
      settledOver: new Map([
        ["env-a", a],
        ["env-b", b],
      ]),
    };
    const pushed = (id: string) => (id === "env-a" ? { hiddenPullRequests: {} } : b);
    expect(sentHiddenPullRequestApplies(sent, pushed)).toBe(true);
    expect(sentHiddenPullRequestApplies(sent, () => ({ hiddenPullRequests: {} }))).toBe(false);
  });
});
