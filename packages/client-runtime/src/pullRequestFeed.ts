import type {
  ProjectId,
  PullRequestFeedRule,
  PullRequestInvolvement,
  ServerSettings,
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
  { value: "involved", label: "Involving me" },
  { value: "reviewing", label: "Waiting on me" },
  { value: "authored", label: "Authored by me" },
  { value: "hidden", label: "Hidden" },
];

/** The rules every server to write can store; servers without `pullRequestFeedInvolved` refuse it. */
export function pullRequestFeedRuleOptions(
  capabilities: Iterable<{ readonly pullRequestFeedInvolved?: boolean } | undefined>,
): typeof PULL_REQUEST_FEED_RULES {
  for (const capability of capabilities) {
    if (capability?.pullRequestFeedInvolved !== true) {
      return PULL_REQUEST_FEED_RULES.filter((option) => option.value !== "involved");
    }
  }
  return PULL_REQUEST_FEED_RULES;
}

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

/**
 * A row an authored or review-requested listing returned keeps that group even when its author
 * login is not the viewer's: the host matched it another way, as GitCafe does by actor. The server
 * already checks the rows of hosts that ignore those listings.
 */
export function pullRequestListedGroup(
  entry: Parameters<typeof pullRequestFeedGroup>[0] & { readonly url: string },
  viewer: string | null | undefined,
  listed: { readonly authored: ReadonlySet<string>; readonly reviewing: ReadonlySet<string> },
): PullRequestFeedGroup {
  if (listed.authored.has(entry.url)) return "authored";
  const own = pullRequestFeedGroup(entry, viewer);
  return own === "others" && listed.reviewing.has(entry.url) ? "reviewRequested" : own;
}

/**
 * A narrowed involvement tab holds one group of that kind, whatever its key says. `involved` says
 * the host lists the viewer as taking part in an Others row, by a comment, mention, or assignment.
 */
export function pullRequestFeedShows(
  rule: PullRequestFeedRule,
  group: PullRequestFeedGroup,
  involvement: PullRequestInvolvement = "all",
  involved = false,
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
    case "involved":
      return kind !== "others" || involved;
    case "authored":
      return kind === "authored";
    case "reviewing":
      return kind === "reviewRequested";
  }
}

/**
 * For `PullRequestFeedOptions.involved`: a row is involved when its project's involved listing
 * holds it. With no answer (a search, or no read), or for a project whose listing is not ready
 * (not read, pending, failed, or unindexed), every row counts, as under the All rule.
 */
export function pullRequestInvolvedMatcher<Row extends { readonly url: string }>(
  answer: {
    readonly entries: ReadonlyArray<{ readonly url: string }>;
    readonly ready: (entry: Row) => boolean;
  } | null,
): (entry: Row) => boolean {
  if (answer === null) return () => true;
  const urls = new Set(answer.entries.map((entry) => entry.url));
  return (entry) => urls.has(entry.url) || !answer.ready(entry);
}

type HiddenSettings = Pick<ServerSettings, "hiddenPullRequests"> | null | undefined;

/** The key a hidden link is stored under; hiding or unhiding patches only this key. */
export const hiddenPullRequestKey = (url: string): string => url.toLowerCase();

/**
 * Every environment's hidden links, keyed by `hiddenPullRequestKey`, each in the spelling it was
 * hidden with, so a pull request stays hidden when another environment serves it.
 */
export function hiddenPullRequestLinks(
  settings: Iterable<HiddenSettings>,
): ReadonlyMap<string, string> {
  const links = new Map<string, string>();
  for (const entry of settings) {
    for (const [key, url] of Object.entries(entry?.hiddenPullRequests ?? {})) {
      if (!links.has(hiddenPullRequestKey(key))) links.set(hiddenPullRequestKey(key), url);
    }
  }
  return links;
}

export function hiddenPullRequestUrls(settings: Iterable<HiddenSettings>): ReadonlySet<string> {
  return new Set(hiddenPullRequestLinks(settings).keys());
}

export function isPullRequestHidden(hidden: ReadonlySet<string>, url: string): boolean {
  return hidden.size > 0 && hidden.has(hiddenPullRequestKey(url));
}

export interface PullRequestFeedOptions<Entry> {
  /** Rules apply only to the combined feed, not when the list shows one project. */
  readonly scopedToProject: boolean;
  readonly involvement: PullRequestInvolvement;
  /** The rules of the row's counted copies, else its own; the row shows when any of them shows it. */
  readonly rulesFor: (entry: Entry) => ReadonlyArray<PullRequestFeedRule>;
  readonly hidden: ReadonlySet<string>;
  /** The row's own group, when the list may file it under another one. */
  readonly groupOf?: (entry: Entry) => PullRequestFeedGroup;
  /** Whether the host's `involved` listing holds the row; absent counts only the row's group. */
  readonly involved?: (entry: Entry) => boolean;
  /** A repository another environment's project hides, read before copies merge. */
  readonly repositoryHidden?: (entry: Entry) => boolean;
}

/**
 * Whether a project's `hidden` rule removes its repository from every environment's list. Only a
 * connected environment counts, so an offline one's cached rule cannot trap the repository.
 */
export function pullRequestProjectHidesRepository(
  rule: PullRequestFeedRule,
  environment: { readonly connected: boolean },
): boolean {
  return rule === "hidden" && environment.connected;
}

/**
 * Whether a row's repository is one some environment's project hides, matched on the projects'
 * repository keys like the web query assignment, so every environment's copy leaves the feed.
 */
export function pullRequestRepositoryHidden<Project extends RepositoryProject>(
  projects: ReadonlyArray<Project>,
  isHidden: (project: Project) => boolean,
): (entry: { readonly environmentId: string; readonly projectId: ProjectId }) => boolean {
  const keys = new Map<string, string>();
  const hidden = new Set<string>();
  for (const project of projects) {
    const key = project.repositoryIdentity?.canonicalKey?.toLowerCase();
    if (!key) continue;
    keys.set(`${project.environmentId} ${project.id}`, key);
    if (isHidden(project)) hidden.add(key);
  }
  return (entry) => {
    if (hidden.size === 0) return false;
    const key = keys.get(`${entry.environmentId} ${entry.projectId}`);
    return key !== undefined && hidden.has(key);
  };
}

type RepositoryProject = {
  readonly id: ProjectId;
  readonly environmentId: string;
  readonly repositoryIdentity?: { readonly canonicalKey?: string | undefined } | null | undefined;
};

/**
 * The rules of every counted copy of a row's repository, matched on the same repository key as
 * `pullRequestRepositoryHidden`, so a row shows when any copy's rule allows it. The row's own rule
 * applies only when no copy counts.
 */
export function pullRequestRepositoryRules<
  Project extends RepositoryProject,
  Entry extends { readonly environmentId: string; readonly projectId: ProjectId },
>(
  projects: ReadonlyArray<Project>,
  ruleOf: (project: Project) => PullRequestFeedRule,
  counts: (project: Project) => boolean,
  ownRuleOf: (entry: Entry) => PullRequestFeedRule,
): (entry: Entry) => ReadonlyArray<PullRequestFeedRule> {
  const keys = new Map<string, string>();
  const rules = new Map<string, PullRequestFeedRule[]>();
  for (const project of projects) {
    const key = project.repositoryIdentity?.canonicalKey?.toLowerCase();
    if (!key) continue;
    keys.set(`${project.environmentId} ${project.id}`, key);
    if (!counts(project)) continue;
    const held = rules.get(key);
    if (held === undefined) rules.set(key, [ruleOf(project)]);
    else held.push(ruleOf(project));
  }
  return (entry) => {
    const key = keys.get(`${entry.environmentId} ${entry.projectId}`);
    const counted = key === undefined ? undefined : rules.get(key);
    return counted ?? [ownRuleOf(entry)];
  };
}

/** `rule` drops the row silently; `hidden` is a row the user hid and can show again. */
export function pullRequestFeedVisibility<Entry extends { readonly url: string }>(
  entry: Entry,
  group: PullRequestFeedGroup,
  options: PullRequestFeedOptions<Entry>,
): "shown" | "rule" | "hidden" {
  if (!options.scopedToProject) {
    let ownGroup: PullRequestFeedGroup | undefined;
    const admitted =
      options.repositoryHidden?.(entry) !== true &&
      options.rulesFor(entry).some((rule) => {
        const involved = rule === "involved" && options.involved?.(entry) === true;
        if (pullRequestFeedShows(rule, group, options.involvement, involved)) return true;
        ownGroup ??= options.groupOf?.(entry);
        return (
          ownGroup !== undefined &&
          pullRequestFeedShows(rule, ownGroup, options.involvement, involved)
        );
      });
    if (!admitted) return "rule";
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
): {
  readonly groups: ReadonlyArray<Group>;
  readonly hiddenCount: number;
  readonly ruledOutCount: number;
} {
  let hiddenCount = 0;
  let ruledOutCount = 0;
  let changed = false;
  const next = groups.flatMap((group) => {
    const entries = group.entries.filter((entry) => {
      const visibility = pullRequestFeedVisibility(entry, group.key, options);
      if (visibility === "hidden") hiddenCount += 1;
      if (visibility === "rule") ruledOutCount += 1;
      return visibility === "shown" || (visibility === "hidden" && options.showHidden === true);
    });
    if (entries.length === group.entries.length) return [group];
    changed = true;
    return entries.length === 0 ? [] : [{ ...group, entries }];
  });
  return { groups: changed ? next : groups, hiddenCount, ruledOutCount };
}
