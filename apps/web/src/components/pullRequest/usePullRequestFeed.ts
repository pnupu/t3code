import {
  hiddenPullRequestKey,
  hiddenPullRequestLinks,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  PULL_REQUEST_FEED_RULES,
  pullRequestFeedRule,
  pullRequestFeedRuleRows,
  type PullRequestFeedRuleRow,
  pullRequestProjectHidesRepository,
  pullRequestRepositoryHidden,
  pullRequestRepositoryRules,
} from "@t3tools/client-runtime/pull-request-feed";
import {
  AuthSettingsWriteScope,
  type ContextMenuItem,
  type EnvironmentId,
  type ProjectId,
  type PullRequestFeedRule,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { readLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { readEnvironmentScope } from "~/state/session";

import {
  applyPendingScopedWrites,
  isConnectedWithConfig,
  pendingScopedWritesAtom,
  planEnvironmentSettingsPatch,
  planProjectOverridePatch,
  planProjectOverridesClear,
} from "../settings/scopedSettings";
import { useRunScopedPlan } from "../settings/useScopedSettings";
import { runPullRequestLinkAction } from "./pullRequestLinkContextMenu";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";

type FeedMenuAction =
  | "copy-link"
  | "open-external"
  | "hide"
  | "unhide"
  | `rule:${PullRequestFeedRule}`;

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const { environments: known } = useEnvironments();
  const pendingWrites = useAtomValue(pendingScopedWritesAtom);
  const environments = applyPendingScopedWrites(known, pendingWrites);
  const runPlan = useRunScopedPlan();
  const settingsOf = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.settings;
  const allSettings = environments.map((environment) => environment.serverConfig?.settings);
  const hidden = hiddenPullRequestUrls(allSettings);
  const hiddenUrls = [...hiddenPullRequestLinks(allSettings).values()];

  const ruleFor = (entry: { environmentId: EnvironmentId; projectId: ProjectId }) =>
    pullRequestFeedRule(settingsOf(entry.environmentId), entry.projectId);
  const projects = useProjects();
  /** Older servers drop these settings, and a standard pairing cannot write settings. */
  const canWrite = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.environment.capabilities.pullRequestFeed === true &&
    readEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const connected = new Set(
    environments.flatMap((environment) =>
      isConnectedWithConfig(environment) ? [environment.environmentId] : [],
    ),
  );
  /** The one rule for which projects hide their repository, shared by queries and rows. */
  const hidesRepository = (project: { environmentId: EnvironmentId; id: ProjectId }) =>
    pullRequestProjectHidesRepository(
      ruleFor({ environmentId: project.environmentId, projectId: project.id }),
      { connected: connected.has(project.environmentId) },
    );
  // A repository one environment hides leaves every environment's copy, including carried rows.
  const repositoryHidden = pullRequestRepositoryHidden(projects, hidesRepository);
  /** Every connected copy's rule counts, so the same settings give the same feed on any device. */
  const ruleCounts = (environmentId: EnvironmentId) =>
    connected.has(environmentId) &&
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.environment.capabilities.pullRequestFeed === true;
  // Every environment that holds the link hides it, so all of them must be able to clear it.
  const holders = (url: string) =>
    environments.filter((environment) =>
      isPullRequestHidden(hiddenPullRequestUrls([environment.serverConfig?.settings]), url),
    );
  /** The environment that keeps the link hidden because this client cannot clear it there. */
  const unhideBlockedBy = (url: string) =>
    holders(url).find(
      (environment) => !isConnectedWithConfig(environment) || !canWrite(environment.environmentId),
    )?.label ?? null;
  const canUnhide = (url: string) => holders(url).length > 0 && unhideBlockedBy(url) === null;

  // One key per write, so concurrent hides and unhides from anywhere cannot erase each other.
  const hide = (entry: Pick<EnvironmentPullRequestEntry, "environmentId" | "url">) =>
    runPlan(
      environments.filter((environment) => environment.environmentId === entry.environmentId),
      (current) =>
        planEnvironmentSettingsPatch(current, {
          hiddenPullRequests: { [hiddenPullRequestKey(entry.url)]: entry.url },
        }),
    );

  const unhide = (url: string) => {
    if (!canUnhide(url)) return;
    runPlan(holders(url), (current) =>
      planEnvironmentSettingsPatch(current, {
        hiddenPullRequests: { [hiddenPullRequestKey(url)]: null },
      }),
    );
  };

  type ScopeProject = (typeof projects)[number];
  // The writable copies in the list's scope; an offline one is skipped and keeps its rule.
  const ruleMembers = (
    project: { environmentId: EnvironmentId; projectId: ProjectId },
    scope: ReadonlyArray<ScopeProject>,
  ) => {
    const repositoryKeyOf = (candidate: ScopeProject | undefined) =>
      candidate?.repositoryIdentity?.canonicalKey?.toLowerCase();
    const own = scope.find(
      (candidate) =>
        candidate.environmentId === project.environmentId && candidate.id === project.projectId,
    );
    // A carried row from outside the scope writes nothing the list does not show.
    if (own === undefined) return [];
    const key = repositoryKeyOf(own);
    if (key) {
      return scope.filter(
        (candidate) => repositoryKeyOf(candidate) === key && canWrite(candidate.environmentId),
      );
    }
    return canWrite(own.environmentId) ? [own] : [];
  };

  const setProjectRule = (members: ReturnType<typeof ruleMembers>, rule: PullRequestFeedRule) => {
    runPlan(environments, (current) =>
      planProjectOverridePatch(current, members, { pullRequestFeed: rule }),
    );
  };

  /** One row per repository in these environments, for the Settings overview. */
  const ruleRows = (environmentIds: ReadonlyArray<EnvironmentId>) =>
    pullRequestFeedRuleRows(
      projects.filter((project) => environmentIds.includes(project.environmentId)),
      (environmentId) => {
        const environment = environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        const config = environment?.serverConfig;
        if (!environment || !config) return undefined;
        return {
          label: environment.label,
          settings: config.settings,
          access: !connected.has(environmentId)
            ? "disconnected"
            : config.environment.capabilities.pullRequestFeed !== true
              ? "outdated"
              : readEnvironmentScope(environmentId, AuthSettingsWriteScope)
                ? "writable"
                : "read-only",
        };
      },
    );
  type RuleRow = PullRequestFeedRuleRow<ScopeProject>;
  const writableCopies = (row: RuleRow) => row.copies.filter((copy) => copy.access === "writable");
  const setRowRule = (row: RuleRow, rule: PullRequestFeedRule) =>
    setProjectRule(
      writableCopies(row).map((copy) => copy.project),
      rule,
    );
  const resetRowRule = (row: RuleRow) =>
    runPlan(environments, (current) =>
      planProjectOverridesClear(
        current,
        writableCopies(row).flatMap((copy) =>
          copy.overridden
            ? [{ environmentId: copy.project.environmentId, projectId: copy.project.id }]
            : [],
        ),
        ["pullRequestFeed"],
      ),
    );

  const openRowMenu = async (
    entry: EnvironmentPullRequestEntry,
    openLabel: string,
    position: { readonly x: number; readonly y: number },
    scope: ReadonlyArray<ScopeProject>,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const isHidden = isPullRequestHidden(hidden, entry.url);
    // The same scope as the list, so the checkmarks and the write cover the same copies.
    const rules = pullRequestRepositoryRules(
      scope,
      (project) => ruleFor({ environmentId: project.environmentId, projectId: project.id }),
      (project) => ruleCounts(project.environmentId),
      ruleFor,
    )(entry);
    const members = ruleMembers(entry, scope);
    const writable = canWrite(entry.environmentId);
    const items: ContextMenuItem<FeedMenuAction>[] = [
      { id: "copy-link", label: "Copy link", icon: "copy" },
      { id: "open-external", label: openLabel },
      isHidden
        ? {
            id: "unhide",
            label: "Show in feed",
            separatorBefore: true,
            disabled: !canUnhide(entry.url),
            ...(unhideBlockedBy(entry.url) === null
              ? {}
              : { detail: `Hidden by ${unhideBlockedBy(entry.url)}` }),
          }
        : { id: "hide", label: "Hide from feed", separatorBefore: true, disabled: !writable },
      {
        id: "rule:all",
        label: `Feed for ${entry.projectTitle}`,
        disabled: members.length === 0,
        children: PULL_REQUEST_FEED_RULES.map((option) => ({
          id: `rule:${option.value}` as const,
          label: option.label,
          checked: rules.includes(option.value),
        })),
      },
    ];
    let action: FeedMenuAction | null = null;
    try {
      action = await api.contextMenu.show(items, position);
    } catch {
      return;
    }
    if (action === "copy-link" || action === "open-external") {
      await runPullRequestLinkAction(action, entry.url);
    } else if (action === "hide") {
      hide(entry);
    } else if (action === "unhide") {
      unhide(entry.url);
    } else {
      const picked = PULL_REQUEST_FEED_RULES.find((option) => action === `rule:${option.value}`);
      if (picked) setProjectRule(members, picked.value);
    }
  };

  const showRowMenu = useStableCallback((...args: Parameters<typeof openRowMenu>) => {
    void openRowMenu(...args);
  });

  return {
    hidden,
    hiddenUrls,
    ruleFor,
    ruleCounts,
    hidesRepository,
    repositoryHidden,
    unhide,
    canUnhide,
    unhideBlockedBy,
    showRowMenu,
    ruleRows,
    setRowRule,
    resetRowRule,
  };
}
