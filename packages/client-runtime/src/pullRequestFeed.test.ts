import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId, type PullRequestFeedRule } from "@t3tools/contracts";

import {
  filterPullRequestFeed,
  hiddenPullRequestLinks,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  pullRequestFeedVisibility,
  pullRequestProjectHidesRepository,
  pullRequestRepositoryHidden,
  pullRequestRepositoryRules,
  pullRequestFeedGroup,
  pullRequestFeedRule,
  pullRequestFeedShows,
  pullRequestFeedRuleRows,
  pullRequestFeedRuleTargets,
  type PullRequestFeedGroup,
  type PullRequestFeedRuleEnvironment,
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
      rulesFor: (entry: { projectId: ProjectId }) => [rules[entry.projectId] ?? "all"],
      hidden: new Set(["https://h/b/3"]),
    };

    expect(filterPullRequestFeed(groups, { ...options, scopedToProject: false })).toEqual({
      groups: [groups[0]],
      hiddenCount: 1,
      ruledOutCount: 1,
    });
    expect(
      filterPullRequestFeed(groups, { ...options, scopedToProject: false, showHidden: true }),
    ).toEqual({
      groups: [groups[0], { key: "others", entries: [row(projectB, "https://H/B/3")] }],
      hiddenCount: 1,
      ruledOutCount: 1,
    });
    expect(filterPullRequestFeed(groups, { ...options, scopedToProject: true })).toEqual({
      groups: [groups[0], { key: "others", entries: [row(projectA, "https://h/a/2")] }],
      hiddenCount: 1,
      ruledOutCount: 0,
    });
  });

  it.each<[string, PullRequestFeedRule, PullRequestFeedGroup, PullRequestFeedGroup, boolean]>([
    ["admits a row its own group admits", "authored", "others", "authored", true],
    ["admits a row its list group admits", "reviewing", "reviewRequested", "others", true],
    ["drops a row neither group admits", "authored", "others", "reviewRequested", false],
  ])("%s", (_, rule, listGroup, ownGroup, shown) => {
    expect(
      pullRequestFeedVisibility({ url: "https://h/a/1" }, listGroup, {
        scopedToProject: false,
        involvement: "all",
        rulesFor: () => [rule],
        hidden: new Set(),
        groupOf: () => ownGroup,
      }),
    ).toBe(shown ? "shown" : "rule");
  });

  it.each<[string, PullRequestFeedRule, boolean, boolean]>([
    ["a connected holder hides", "hidden", true, true],
    ["an offline holder does not", "hidden", false, false],
    ["another rule does not", "authored", true, false],
  ])("%s its repository", (_, rule, connected, hides) => {
    expect(pullRequestProjectHidesRepository(rule, { connected })).toBe(hides);
  });

  it("rules out every environment's copy of a repository one environment hides", () => {
    const project = (environmentId: string, id: string, canonicalKey: string) => ({
      id: ProjectId.make(id),
      environmentId,
      repositoryIdentity: { canonicalKey },
    });
    const repositoryHidden = pullRequestRepositoryHidden(
      [
        project("env-1", "a1", "github.com/X/A"),
        project("env-2", "a2", "github.com/x/a"),
        project("env-2", "b2", "github.com/x/b"),
      ],
      (candidate) => candidate.environmentId === "env-1" && candidate.id === "a1",
    );
    const options = {
      scopedToProject: false,
      involvement: "all" as const,
      rulesFor: () => ["all" as const],
      hidden: new Set<string>(),
      repositoryHidden,
    };
    const rows = [
      { environmentId: "env-1", projectId: ProjectId.make("a1"), url: "https://h/a/1" },
      { environmentId: "env-2", projectId: ProjectId.make("a2"), url: "https://h/a/2" },
      { environmentId: "env-2", projectId: ProjectId.make("b2"), url: "https://h/b/3" },
    ];
    expect(rows.map((row) => pullRequestFeedVisibility(row, "others", options))).toEqual([
      "rule",
      "rule",
      "shown",
    ]);
    expect(
      pullRequestFeedVisibility(rows[1]!, "others", { ...options, scopedToProject: true }),
    ).toBe("shown");
  });

  it("shows a row when any copy of its repository allows it", () => {
    const project = (environmentId: string, id: string) => ({
      id: ProjectId.make(id),
      environmentId,
      repositoryIdentity: { canonicalKey: "github.com/x/a" },
    });
    const rulesFor = pullRequestRepositoryRules(
      [project("env-1", "a1"), project("env-2", "a2")],
      (candidate) => (candidate.environmentId === "env-1" ? "authored" : "all"),
      () => true,
      () => "authored",
    );
    const row = { environmentId: "env-1", projectId: ProjectId.make("a1"), url: "https://h/a/9" };
    // Another author's pull request, read through the authored-only copy.
    expect(
      pullRequestFeedVisibility(row, "others", {
        scopedToProject: false,
        involvement: "all",
        rulesFor,
        hidden: new Set(),
      }),
    ).toBe("shown");
    // A copy that does not count, such as an offline one, adds no rule; a keyless row keeps its own.
    const counted = pullRequestRepositoryRules(
      [project("env-1", "a1"), project("env-2", "a2")],
      (candidate) => (candidate.environmentId === "env-1" ? "authored" : "all"),
      (candidate) => candidate.environmentId === "env-1",
      (entry) => (entry.environmentId === "env-2" ? "all" : "authored"),
    );
    expect(counted(row)).toEqual(["authored"]);
    // The row's own copy does not count, so its default "all" must not widen a counted narrower rule.
    expect(counted({ environmentId: "env-2", projectId: ProjectId.make("a2") })).toEqual([
      "authored",
    ]);
    expect(counted({ environmentId: "env-3", projectId: ProjectId.make("x") })).toEqual([
      "authored",
    ]);
    // A keyed repository with no counted copy falls back to the row's own rule, not to no rule.
    const uncounted = pullRequestRepositoryRules(
      [project("env-1", "a1"), project("env-2", "a2")],
      () => "authored",
      () => false,
      () => "reviewing",
    );
    expect(uncounted(row)).toEqual(["reviewing"]);
  });

  it("reads every environment's hidden links, regardless of case", () => {
    const settings = [
      { hiddenPullRequests: { "https://h/a/1": "https://H/A/1" } },
      null,
      {
        hiddenPullRequests: { "https://H/A/1": "https://h/a/1", "https://h/b/2": "https://h/b/2" },
      },
    ];
    expect([...hiddenPullRequestLinks(settings)]).toEqual([
      ["https://h/a/1", "https://H/A/1"],
      ["https://h/b/2", "https://h/b/2"],
    ]);
    expect(isPullRequestHidden(hiddenPullRequestUrls(settings), "https://h/A/1")).toBe(true);
  });
});

describe("pull request feed rule rows", () => {
  const settings = (
    pullRequestFeed: PullRequestFeedRule,
    overrides: Record<string, PullRequestFeedRule> = {},
  ) => ({
    ...DEFAULT_SERVER_SETTINGS,
    pullRequestFeed,
    projectSettingsOverrides: Object.fromEntries(
      Object.entries(overrides).map(([id, rule]) => [id, { pullRequestFeed: rule }]),
    ),
  });
  const project = (environmentId: string, id: string, canonicalKey?: string) => ({
    environmentId,
    id: ProjectId.make(id),
    title: id,
    repositoryIdentity: canonicalKey === undefined ? null : { canonicalKey },
  });
  const rows = (
    projects: ReadonlyArray<ReturnType<typeof project>>,
    environments: Record<
      string,
      Partial<PullRequestFeedRuleEnvironment> & { settings: ReturnType<typeof settings> }
    >,
  ) =>
    pullRequestFeedRuleRows(projects, (environmentId) => {
      const environment = environments[environmentId];
      return environment === undefined
        ? undefined
        : {
            label: environmentId,
            connected: true,
            capable: true,
            writeGranted: true,
            ...environment,
          };
    });

  it("groups a repository's copies into one row and gives an unidentified project its own", () => {
    const result = rows(
      [
        project("laptop", "web", "github.com/x/Web"),
        project("server", "web-copy", "github.com/x/web"),
        project("laptop", "notes"),
        project("offline", "lost", "github.com/x/web"),
      ],
      { laptop: { settings: settings("all") }, server: { settings: settings("all") } },
    );
    expect(result.map((row) => [row.name, row.covers])).toEqual([
      ["github.com/x/Web", "web, web-copy · laptop, server"],
      ["notes", "notes · laptop"],
    ]);
  });

  it("shows an inherited rule as the default and offers no reset", () => {
    const [row] = rows([project("laptop", "web", "k"), project("server", "web", "k")], {
      laptop: { settings: settings("authored") },
      server: { settings: settings("authored") },
    });
    expect(row).toMatchObject({ rule: "authored", status: "Default rule.", canReset: false });
  });

  it("names each rule's environments when copies differ", () => {
    const [row] = rows([project("laptop", "web", "k"), project("server", "web", "k")], {
      laptop: { settings: settings("all") },
      server: { settings: settings("all", { web: "hidden" }) },
    });
    expect(row).toMatchObject({
      rule: null,
      status: "Differs: All pull requests on laptop; Hidden on server.",
      canReset: true,
    });
  });

  it("leaves an outdated server's fallback out of the comparison but keeps its note", () => {
    const [row] = rows([project("laptop", "web", "k"), project("old", "web", "k")], {
      laptop: { settings: settings("all", { web: "hidden" }) },
      old: { settings: settings("all"), capable: false },
    });
    expect(row).toMatchObject({ rule: "hidden", status: "Update old to change it." });
  });

  it("writes a pick only to writable copies not already on it", () => {
    const [row] = rows(
      [project("laptop", "web", "k"), project("server", "web", "k"), project("mac", "web", "k")],
      {
        laptop: { settings: settings("all") },
        server: { settings: settings("all", { web: "authored" }) },
        mac: { settings: settings("hidden"), connected: false },
      },
    );
    // Picking the rule the laptop copy inherits must not pin it there.
    expect(pullRequestFeedRuleTargets(row!, "all").map((copy) => copy.environmentId)).toEqual([
      "server",
    ]);
    expect(pullRequestFeedRuleTargets(row!, null).map((copy) => copy.environmentId)).toEqual([
      "server",
    ]);
  });

  it("says which copies this client cannot change and resets only writable ones", () => {
    const [row] = rows(
      [project("laptop", "web", "k"), project("server", "web", "k"), project("corp", "web", "k")],
      {
        laptop: { settings: settings("all"), connected: false },
        server: { settings: settings("all", { web: "all" }), writeGranted: false },
        // The server refuses a project override of a locked setting.
        corp: {
          settings: settings("all", { web: "all" }),
          managedPolicy: { organization: "Acme", lockedSettings: ["pullRequestFeed"] },
        },
      },
    );
    expect(row).toMatchObject({
      rule: "all",
      status:
        "Connect laptop to change it. This connection cannot change settings on server. Managed by Acme on corp.",
      canReset: false,
    });
    expect(row?.copies.map((copy) => copy.access)).toEqual([
      "disconnected",
      "read-only",
      "managed",
    ]);
  });
});
