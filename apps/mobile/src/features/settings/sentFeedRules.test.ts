import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { openSentFeedRules } from "./sentFeedRules";

describe("feed rules sent from the overview", () => {
  const web = ProjectId.make("web");
  const inherits = { projectSettingsOverrides: {} };
  const hidden = { projectSettingsOverrides: { [web]: { pullRequestFeed: "hidden" as const } } };

  it("keeps a reset across two servers open until the second one shows it", () => {
    const sent = [
      { environmentId: "laptop", projectId: web, rule: undefined },
      { environmentId: "server", projectId: web, rule: undefined },
    ];
    const settings: Record<string, typeof inherits | typeof hidden> = {
      laptop: inherits,
      server: hidden,
    };
    expect(openSentFeedRules(sent, (id) => settings[id])).toEqual([sent[1]]);
    settings.server = inherits;
    expect(openSentFeedRules(sent, (id) => settings[id])).toEqual([]);
  });

  it("ends a saved no-op at once and a saved change at the next update", () => {
    const noop = { environmentId: "laptop", projectId: web, rule: "hidden" as const };
    expect(openSentFeedRules([noop], () => hidden)).toEqual([]);
    const change = {
      environmentId: "laptop",
      projectId: web,
      rule: "all" as const,
      repliedOver: hidden,
    };
    // The reply beat the push: the copy still shows the old rule.
    expect(openSentFeedRules([change], () => hidden)).toEqual([change]);
    // Any later update answers it, even another client's newer rule.
    expect(
      openSentFeedRules([change], () => ({
        projectSettingsOverrides: { [web]: { pullRequestFeed: "authored" as const } },
      })),
    ).toEqual([]);
  });
});
