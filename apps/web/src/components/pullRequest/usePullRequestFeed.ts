import {
  hiddenPullRequestList,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  PULL_REQUEST_FEED_RULES,
  pullRequestFeedRule,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
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
import { useEnvironments } from "~/state/environments";
import { readEnvironmentScope } from "~/state/session";

import {
  applyPendingScopedWrites,
  pendingScopedWritesAtom,
  planEnvironmentSettingsPatch,
  planProjectOverridePatch,
} from "../settings/scopedSettings";
import { useRunScopedPlan } from "../settings/useScopedSettings";
import { runPullRequestLinkAction } from "./pullRequestLinkContextMenu";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import type { PullRequestRowMenu } from "./PullRequestRow";

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
  const hiddenUrls = hiddenPullRequestList(allSettings);

  const ruleFor = (entry: { environmentId: EnvironmentId; projectId: ProjectId }) =>
    pullRequestFeedRule(settingsOf(entry.environmentId), entry.projectId);

  /** Older servers drop these settings, and a standard pairing cannot write settings. */
  const canWrite = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.environment.capabilities.pullRequestFeed === true &&
    readEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const holders = (url: string) =>
    environments.filter(
      (environment) =>
        canWrite(environment.environmentId) &&
        isPullRequestHidden(hiddenPullRequestUrls([environment.serverConfig?.settings]), url),
    );

  const hide = (entry: Pick<EnvironmentPullRequestEntry, "environmentId" | "url">) =>
    runPlan(
      environments.filter((environment) => environment.environmentId === entry.environmentId),
      (current) =>
        planEnvironmentSettingsPatch(current, (settings) => ({
          hiddenPullRequests: withHiddenPullRequest(settings.hiddenPullRequests, entry.url),
        })),
    );

  // Every environment that holds the link hides it, so unhiding clears them all.
  const unhide = (url: string) =>
    runPlan(holders(url), (current) =>
      planEnvironmentSettingsPatch(current, (settings) => {
        const next = withoutHiddenPullRequest(settings.hiddenPullRequests, url);
        return next.length === settings.hiddenPullRequests.length
          ? null
          : { hiddenPullRequests: next };
      }),
    );

  const setProjectRule = (
    project: { environmentId: EnvironmentId; projectId: ProjectId },
    rule: PullRequestFeedRule,
  ) =>
    runPlan(environments, (current) =>
      planProjectOverridePatch(
        current,
        { id: project.projectId, environmentId: project.environmentId },
        { pullRequestFeed: rule },
      ),
    );

  const openRowMenu = async (
    entry: EnvironmentPullRequestEntry,
    openLabel: string,
    position: { readonly x: number; readonly y: number },
    source: ContextMenuSource,
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const isHidden = isPullRequestHidden(hidden, entry.url);
    const rule = ruleFor(entry);
    const writable = canWrite(entry.environmentId);
    const items: ContextMenuItem<FeedMenuAction>[] = [
      { id: "copy-link", label: "Copy link", icon: "copy" },
      { id: "open-external", label: openLabel },
      isHidden
        ? {
            id: "unhide",
            label: "Show in feed",
            separatorBefore: true,
            disabled: holders(entry.url).length === 0,
          }
        : { id: "hide", label: "Hide from feed", separatorBefore: true, disabled: !writable },
      {
        id: "rule:all",
        label: `Feed for ${entry.projectTitle}`,
        disabled: !writable,
        children: PULL_REQUEST_FEED_RULES.map((option) => ({
          id: `rule:${option.value}` as const,
          label: option.label,
          checked: option.value === rule,
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

  const showRowMenu: PullRequestRowMenu = useStableCallback((entry, openLabel, position, source) => {
    void openRowMenu(entry, openLabel, position, source);
  });

  const canUnhide = (url: string) => holders(url).length > 0;

  return { hidden, hiddenUrls, ruleFor, unhide, canUnhide, showRowMenu };
}
