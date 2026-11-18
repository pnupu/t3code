import { describe, expect, it } from "vite-plus/test";

import { sentHiddenPullRequestApplies } from "./sentHiddenPullRequests";

describe("a hide or unhide sent from this device", () => {
  const key = "https://h/a/1";
  const shown = { hiddenPullRequests: {} };
  const hidden = { hiddenPullRequests: { [key]: key } };

  it("ends when the settings show it, even if the push beat the reply", () => {
    const sent = { url: key, targets: new Map([["env-1", {}]]) };
    expect(sentHiddenPullRequestApplies(sent, key, () => shown)).toBe(true);
    expect(sentHiddenPullRequestApplies(sent, key, () => hidden)).toBe(false);
  });

  it("does not mask another client's re-hide after the unhide was confirmed", () => {
    const sent = { url: null, targets: new Map([["env-1", { repliedOver: hidden }]]) };
    // The reply came before the push: the stale settings still hide the link.
    expect(sentHiddenPullRequestApplies(sent, key, () => hidden)).toBe(true);
    // Another client hides it again; any update after the reply is authoritative.
    expect(
      sentHiddenPullRequestApplies(sent, key, () => ({ hiddenPullRequests: { [key]: key } })),
    ).toBe(false);
  });
});
