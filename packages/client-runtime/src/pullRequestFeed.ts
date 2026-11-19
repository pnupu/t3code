import {
  isManagedSettingPath,
  type ManagedPolicySummary,
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
  readonly repositoryIdentity?:
    | { readonly canonicalKey?: string | undefined; readonly displayName?: string | undefined }
    | null
    | undefined;
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
        if (pullRequestFeedShows(rule, group, options.involvement)) return true;
        ownGroup ??= options.groupOf?.(entry);
        return ownGroup !== undefined && pullRequestFeedShows(rule, ownGroup, options.involvement);
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

/** Why this client cannot change a copy's rule, or `writable`. */
export type PullRequestFeedRuleAccess =
  | "writable"
  | "disconnected"
  | "outdated"
  | "managed"
  | "read-only";

/** What an environment tells the overview about its copies. */
export interface PullRequestFeedRuleEnvironment {
  readonly label: string;
  readonly settings: PullRequestFeedSettings;
  readonly connected: boolean;
  /** The server stores the rule; older ones drop it. */
  readonly capable: boolean;
  /** This connection holds the settings write grant there. */
  readonly writeGranted: boolean;
  readonly managedPolicy?:
    | Pick<ManagedPolicySummary, "organization" | "lockedSettings">
    | undefined;
}

export interface PullRequestFeedRuleCopy<Project> {
  readonly project: Project;
  readonly environmentLabel: string;
  readonly rule: PullRequestFeedRule;
  /** False when the project inherits its environment's default rule. */
  readonly overridden: boolean;
  readonly access: PullRequestFeedRuleAccess;
  /** The organization whose policy locks the rule, when `access` is `managed`. */
  readonly managedBy: string | null;
}

export interface PullRequestFeedRuleRow<Project> {
  readonly key: string;
  readonly name: string;
  /** The project titles and environments the row covers. */
  readonly covers: string;
  readonly copies: ReadonlyArray<PullRequestFeedRuleCopy<Project>>;
  /** The copies' one rule, or null when they differ. */
  readonly rule: PullRequestFeedRule | null;
  /** Inheritance, disagreement, and the copies this client cannot change, in short sentences. */
  readonly status: string;
  readonly canReset: boolean;
}

const ruleLabel = (rule: PullRequestFeedRule) =>
  PULL_REQUEST_FEED_RULES.find((option) => option.value === rule)?.label ?? rule;

const ACCESS_NOTES: Record<
  Exclude<PullRequestFeedRuleAccess, "writable" | "managed">,
  (on: string) => string
> = {
  disconnected: (on) => `Connect ${on} to change it.`,
  outdated: (on) => `Update ${on} to change it.`,
  "read-only": (on) => `This connection cannot change settings on ${on}.`,
};

function pullRequestFeedRuleAccess(environment: PullRequestFeedRuleEnvironment): {
  readonly access: PullRequestFeedRuleAccess;
  readonly managedBy: string | null;
} {
  if (!environment.connected) return { access: "disconnected", managedBy: null };
  if (!environment.capable) return { access: "outdated", managedBy: null };
  // The server refuses a project override of a locked setting too.
  if (isManagedSettingPath(environment.managedPolicy, "pullRequestFeed")) {
    return { access: "managed", managedBy: environment.managedPolicy?.organization ?? null };
  }
  return { access: environment.writeGranted ? "writable" : "read-only", managedBy: null };
}

const unique = (values: ReadonlyArray<string>) => [...new Set(values)];

/**
 * One row per repository, keyed like `pullRequestRepositoryRules`, so a write covers every copy
 * the feed reads. A project without a repository identity gets its own row. Environments without
 * settings are left out: their rule is unknown.
 */
export function pullRequestFeedRuleRows<
  Project extends RepositoryProject & { readonly title: string },
>(
  projects: ReadonlyArray<Project>,
  environmentOf: (
    environmentId: Project["environmentId"],
  ) => PullRequestFeedRuleEnvironment | undefined,
): ReadonlyArray<PullRequestFeedRuleRow<Project>> {
  const groups = new Map<string, { name: string; copies: PullRequestFeedRuleCopy<Project>[] }>();
  for (const project of projects) {
    const environment = environmentOf(project.environmentId);
    if (environment === undefined) continue;
    const identity = project.repositoryIdentity;
    const repositoryKey = identity?.canonicalKey?.toLowerCase();
    const key = repositoryKey ?? `project ${project.environmentId} ${project.id}`;
    const copy: PullRequestFeedRuleCopy<Project> = {
      project,
      environmentLabel: environment.label,
      rule: pullRequestFeedRule(environment.settings, project.id),
      overridden:
        environment.settings.projectSettingsOverrides[project.id]?.pullRequestFeed !== undefined,
      ...pullRequestFeedRuleAccess(environment),
    };
    const group = groups.get(key);
    if (group) group.copies.push(copy);
    else
      groups.set(key, {
        name: identity?.displayName ?? identity?.canonicalKey ?? project.title,
        copies: [copy],
      });
  }
  const rows = [...groups].map(([key, { name, copies }]) => {
    // An outdated server reports its decoded fallback, not a stored rule; its note says so.
    const stored = copies.some((copy) => copy.access !== "outdated")
      ? copies.filter((copy) => copy.access !== "outdated")
      : copies;
    const rules = unique(stored.map((copy) => copy.rule)) as PullRequestFeedRule[];
    const rule = rules.length === 1 ? rules[0]! : null;
    const notes: string[] = [];
    if (rule === null) {
      const parts = rules.map((candidate) => {
        const on = unique(
          stored.filter((copy) => copy.rule === candidate).map((copy) => copy.environmentLabel),
        );
        return `${ruleLabel(candidate)} on ${on.join(", ")}`;
      });
      notes.push(`Differs: ${parts.join("; ")}.`);
    } else if (stored.every((copy) => !copy.overridden)) {
      notes.push("Default rule.");
    }
    for (const access of ["disconnected", "outdated", "read-only"] as const) {
      const on = unique(
        copies.filter((copy) => copy.access === access).map((copy) => copy.environmentLabel),
      );
      if (on.length > 0) notes.push(ACCESS_NOTES[access](on.join(", ")));
    }
    for (const organization of unique(
      copies.flatMap((copy) => (copy.managedBy === null ? [] : [copy.managedBy])),
    )) {
      const on = unique(
        copies
          .filter((copy) => copy.managedBy === organization)
          .map((copy) => copy.environmentLabel),
      );
      notes.push(`Managed by ${organization} on ${on.join(", ")}.`);
    }
    return {
      key,
      name,
      covers: `${unique(copies.map((copy) => copy.project.title)).join(", ")} · ${unique(
        copies.map((copy) => copy.environmentLabel),
      ).join(", ")}`,
      copies,
      rule,
      status: notes.join(" "),
      canReset: copies.some((copy) => copy.overridden && copy.access === "writable"),
    };
  });
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The projects a pick writes: a rule goes to each writable copy not already on it, so a copy that
 * inherits the rule keeps following the default; a reset (`null`) clears each writable override.
 */
export function pullRequestFeedRuleTargets<Project>(
  row: Pick<PullRequestFeedRuleRow<Project>, "copies">,
  rule: PullRequestFeedRule | null,
): ReadonlyArray<Project> {
  return row.copies.flatMap((copy) =>
    copy.access === "writable" && (rule === null ? copy.overridden : copy.rule !== rule)
      ? [copy.project]
      : [],
  );
}
