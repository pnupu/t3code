import { describe, expect, it } from "vite-plus/test";

import { settleSentHiddenPullRequest } from "./sentHiddenPullRequests";

describe("a hide or unhide sent from this device", () => {
  const key = "https://h/a/1";
  const shown = { hiddenPullRequests: {} };
  const hidden = { hiddenPullRequests: { [key]: key } };
  const token = {};

  it("ends when the settings show it, even if the push beat the reply", () => {
    const sent = { token, url: key, targets: new Map([["env-1", {}]]) };
    expect(settleSentHiddenPullRequest(sent, key, () => shown)).toBe(sent);
    expect(settleSentHiddenPullRequest(sent, key, () => hidden)).toBeNull();
  });

  it("does not mask another client's re-hide after the unhide was confirmed", () => {
    const sent = { token, url: null, targets: new Map([["env-1", { repliedOver: hidden }]]) };
    // The reply came before the push: the stale settings still hide the link.
    expect(settleSentHiddenPullRequest(sent, key, () => hidden)).toBe(sent);
    // Another client hides it again; any update after the reply is authoritative.
    expect(
      settleSentHiddenPullRequest(sent, key, () => ({ hiddenPullRequests: { [key]: key } })),
    ).toBeNull();
  });

  it("keeps an unhide across two holders until both answer", () => {
    const sent = {
      token,
      url: null,
      targets: new Map([
        ["env-a", {}],
        ["env-b", {}],
      ]),
    };
    const settled = settleSentHiddenPullRequest(sent, key, (id) =>
      id === "env-a" ? shown : hidden,
    );
    expect([...(settled?.targets.keys() ?? [])]).toEqual(["env-b"]);
    expect(settled?.token).toBe(token);
    expect(settleSentHiddenPullRequest(settled!, key, () => shown)).toBeNull();
  });
});
