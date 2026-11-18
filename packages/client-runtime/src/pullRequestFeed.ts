import {
  HIDDEN_PULL_REQUESTS_LIMIT,
  type ProjectId,
  type PullRequestFeedRule,
  type PullRequestInvolvement,
  type ServerSettings,
} from "@t3tools/contracts";

export type PullRequestFeedSettings = Pick<
  ServerSettings,
  "pullRequestFeed" | "projectSettingsOverrides" | "hiddenPullRequests"
>;

/** Which list group a pull request falls in; authored wins over a review request. */
export type PullRequestFeedGroup = "authored" | "reviewRequested" | "others";

export const PULL_REQUEST_FEED_RULES: ReadonlyArray<{
  readonly value: PullRequestFeedRule;
  readonly label: string;
}> = [
  { value: "all", label: "All pull requests" },
  { value: "reviewing", label: "Waiting on me" },
  { value: "authored", label: "Authored by me" },
  { value: "hidden", label: "Hidden" },
];

export function pullRequestFeedRule(
  settings: PullRequestFeedSettings | null | undefined,
  projectId: ProjectId,
): PullRequestFeedRule {
  if (!settings) return "all";
  return settings.projectSettingsOverrides[projectId]?.pullRequestFeed ?? settings.pullRequestFeed;
}

export function pullRequestFeedGroup(
  entry: {
    readonly author: { readonly login: string } | null;
    readonly viewerReviewRequested: boolean;
  },
  viewer: string | null | undefined,
): PullRequestFeedGroup {
  if (viewer && entry.author?.login.toLowerCase() === viewer.toLowerCase()) return "authored";
  return entry.viewerReviewRequested ? "reviewRequested" : "others";
}

/** A narrowed involvement tab holds one group of that kind, whatever its key says. */
export function pullRequestFeedShows(
  rule: PullRequestFeedRule,
  group: PullRequestFeedGroup,
  involvement: PullRequestInvolvement = "all",
): boolean {
  const kind =
    involvement === "authored"
      ? "authored"
      : involvement === "reviewing"
        ? "reviewRequested"
        : group;
  switch (rule) {
    case "all":
      return true;
    case "hidden":
      return false;
    case "authored":
      return kind === "authored";
    case "reviewing":
      return kind === "reviewRequested";
  }
}

/** Every environment's hidden list counts, so a pull request stays hidden when another serves it. */
export function hiddenPullRequestUrls(
  settings: Iterable<Pick<ServerSettings, "hiddenPullRequests"> | null | undefined>,
): ReadonlySet<string> {
  const urls = new Set<string>();
  for (const entry of settings) {
    for (const url of entry?.hiddenPullRequests ?? []) urls.add(url.toLowerCase());
  }
  return urls;
}

export function isPullRequestHidden(hidden: ReadonlySet<string>, url: string): boolean {
  return hidden.size > 0 && hidden.has(url.toLowerCase());
}

/** The oldest entries fall off at the limit, so hiding always succeeds. */
export function withHiddenPullRequest(
  hidden: ReadonlyArray<string>,
  url: string,
): ReadonlyArray<string> {
  const kept = withoutHiddenPullRequest(hidden, url);
  return [...kept, url].slice(-HIDDEN_PULL_REQUESTS_LIMIT);
}

export function withoutHiddenPullRequest(
  hidden: ReadonlyArray<string>,
  url: string,
): ReadonlyArray<string> {
  const key = url.toLowerCase();
  return hidden.filter((entry) => entry.toLowerCase() !== key);
}

export interface PullRequestFeedOptions<Entry> {
  /** Rules apply only to the combined feed, not when the list shows one project. */
  readonly scopedToProject: boolean;
  readonly involvement: PullRequestInvolvement;
  readonly ruleFor: (entry: Entry) => PullRequestFeedRule;
  readonly hidden: ReadonlySet<string>;
}

/** `rule` drops the row silently; `hidden` is a row the user hid and can show again. */
export function pullRequestFeedVisibility<Entry extends { readonly url: string }>(
  entry: Entry,
  group: PullRequestFeedGroup,
  options: PullRequestFeedOptions<Entry>,
): "shown" | "rule" | "hidden" {
  if (
    !options.scopedToProject &&
    !pullRequestFeedShows(options.ruleFor(entry), group, options.involvement)
  ) {
    return "rule";
  }
  return isPullRequestHidden(options.hidden, entry.url) ? "hidden" : "shown";
}

/** Narrows list groups to the feed. Emptied groups drop out. */
export function filterPullRequestFeed<
  Group extends {
    readonly key: PullRequestFeedGroup;
    readonly entries: ReadonlyArray<{ readonly url: string }>;
  },
>(
  groups: ReadonlyArray<Group>,
  options: PullRequestFeedOptions<Group["entries"][number]> & { readonly showHidden?: boolean },
): { readonly groups: ReadonlyArray<Group>; readonly hiddenCount: number } {
  let hiddenCount = 0;
  let changed = false;
  const next = groups.flatMap((group) => {
    const entries = group.entries.filter((entry) => {
      const visibility = pullRequestFeedVisibility(entry, group.key, options);
      if (visibility === "hidden") hiddenCount += 1;
      return visibility === "shown" || (visibility === "hidden" && options.showHidden === true);
    });
    if (entries.length === group.entries.length) return [group];
    changed = true;
    return entries.length === 0 ? [] : [{ ...group, entries }];
  });
  return { groups: changed ? next : groups, hiddenCount };
}
