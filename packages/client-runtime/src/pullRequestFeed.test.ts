import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, type PullRequestFeedRule } from "@t3tools/contracts";

import {
  filterPullRequestFeed,
  pullRequestFeedGroup,
  pullRequestFeedRule,
  pullRequestFeedShows,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
  type PullRequestFeedGroup,
} from "./pullRequestFeed.ts";

const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");

describe("pull request feed rules", () => {
  it.each<[PullRequestFeedRule, PullRequestFeedGroup, "all" | "authored" | "reviewing", boolean]>([
    ["all", "others", "all", true],
    ["hidden", "authored", "all", false],
    ["authored", "authored", "all", true],
    ["authored", "reviewRequested", "all", false],
    ["authored", "others", "all", false],
    ["reviewing", "reviewRequested", "all", true],
    ["reviewing", "authored", "all", false],
    // A narrowed tab holds one group keyed "others" whose kind is the tab's involvement.
    ["authored", "others", "authored", true],
    ["authored", "others", "reviewing", false],
    ["reviewing", "others", "reviewing", true],
    ["reviewing", "others", "authored", false],
  ])("%s shows a %s row under %s: %s", (rule, group, involvement, shown) => {
    expect(pullRequestFeedShows(rule, group, involvement)).toBe(shown);
  });

  it("resolves a project override over the environment rule", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      pullRequestFeed: "authored" as const,
      projectSettingsOverrides: { [projectA]: { pullRequestFeed: "hidden" as const } },
    };
    expect(pullRequestFeedRule(settings, projectA)).toBe("hidden");
    expect(pullRequestFeedRule(settings, projectB)).toBe("authored");
    expect(pullRequestFeedRule(null, projectB)).toBe("all");
  });

  it("puts authored before a review request", () => {
    const entry = { author: { login: "Me" }, viewerReviewRequested: true };
    expect(pullRequestFeedGroup(entry, "me")).toBe("authored");
    expect(pullRequestFeedGroup(entry, "someone")).toBe("reviewRequested");
    expect(pullRequestFeedGroup({ ...entry, viewerReviewRequested: false }, null)).toBe("others");
  });

  it("applies project rules to the combined feed and hides pull requests in every view", () => {
    const row = (projectId: ProjectId, url: string) => ({ projectId, url });
    const groups = [
      { key: "authored" as const, entries: [row(projectA, "https://h/a/1")] },
      {
        key: "others" as const,
        entries: [row(projectA, "https://h/a/2"), row(projectB, "https://H/B/3")],
      },
    ];
    const rules: Record<string, PullRequestFeedRule> = { [projectA]: "authored" };
    const options = {
      involvement: "all" as const,
      ruleFor: (entry: { projectId: ProjectId }) => rules[entry.projectId] ?? "all",
      hidden: new Set(["https://h/b/3"]),
    };

    expect(filterPullRequestFeed(groups, { ...options, scopedToProject: false })).toEqual({
      groups: [groups[0]],
      hiddenCount: 1,
    });
    expect(
      filterPullRequestFeed(groups, { ...options, scopedToProject: false, showHidden: true }),
    ).toEqual({
      groups: [groups[0], { key: "others", entries: [row(projectB, "https://H/B/3")] }],
      hiddenCount: 1,
    });
    expect(filterPullRequestFeed(groups, { ...options, scopedToProject: true })).toEqual({
      groups: [groups[0], { key: "others", entries: [row(projectA, "https://h/a/2")] }],
      hiddenCount: 1,
    });
  });

  it("hides and unhides by URL regardless of case", () => {
    const hidden = withHiddenPullRequest(["https://h/a/1"], "https://H/A/1");
    expect(hidden).toEqual(["https://H/A/1"]);
    expect(withoutHiddenPullRequest(hidden, "https://h/a/1")).toEqual([]);
  });
});
