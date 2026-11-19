import {
  hiddenPullRequestKey,
  hiddenPullRequestLinks,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  PULL_REQUEST_FEED_RULES,
  pullRequestFeedRule,
  pullRequestProjectHidesRepository,
  pullRequestRepositoryHidden,
} from "@t3tools/client-runtime/pull-request-feed";
import {
  AuthSettingsWriteScope,
  type ContextMenuItem,
  type ContextMenuSource,
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
  /** A copy's rule counts toward a row only where the row menu's rule write reaches it too. */
  const ruleCounts = (environmentId: EnvironmentId) =>
    connected.has(environmentId) && canWrite(environmentId);
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

  // Like Settings' project scope: an offline copy is skipped and keeps its rule until written again.
  const ruleMembers = (project: { environmentId: EnvironmentId; projectId: ProjectId }) => {
    const repositoryKeyOf = (candidate: (typeof projects)[number] | undefined) =>
      candidate?.repositoryIdentity?.canonicalKey?.toLowerCase();
    const key = repositoryKeyOf(
      projects.find(
        (candidate) =>
          candidate.environmentId === project.environmentId && candidate.id === project.projectId,
      ),
    );
    if (key) {
      return projects.filter(
        (candidate) => repositoryKeyOf(candidate) === key && canWrite(candidate.environmentId),
      );
    }
    return canWrite(project.environmentId)
      ? [{ id: project.projectId, environmentId: project.environmentId }]
      : [];
  };

  const setProjectRule = (
    project: { environmentId: EnvironmentId; projectId: ProjectId },
    rule: PullRequestFeedRule,
  ) => {
    const members = ruleMembers(project);
    runPlan(environments, (current) =>
      planProjectOverridePatch(current, members, { pullRequestFeed: rule }),
    );
  };

  const openRowMenu = async (
    entry: EnvironmentPullRequestEntry,
    openLabel: string,
    position: { readonly x: number; readonly y: number },
    rules: ReadonlyArray<PullRequestFeedRule>,
    source: ContextMenuSource,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const isHidden = isPullRequestHidden(hidden, entry.url);
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
        disabled: ruleMembers(entry).length === 0,
        children: PULL_REQUEST_FEED_RULES.map((option) => ({
          id: `rule:${option.value}` as const,
          label: option.label,
          checked: rules.includes(option.value),
        })),
      },
    ];
    let action: FeedMenuAction | null = null;
    try {
      action = await api.contextMenu.show(items, position, source);
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
      if (picked) setProjectRule(entry, picked.value);
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
  };
}
