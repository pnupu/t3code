import {
  hiddenPullRequestUrls,
  isPullRequestHidden,
  PULL_REQUEST_FEED_RULES,
  pullRequestFeedRule,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
} from "@t3tools/client-runtime/pull-request-feed";
import type {
  ContextMenuItem,
  EnvironmentId,
  ProjectId,
  PullRequestFeedRule,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { readLocalApi } from "~/localApi";
import { useEnvironments } from "~/state/environments";

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
  const hidden = hiddenPullRequestUrls(
    environments.map((environment) => environment.serverConfig?.settings),
  );

  const ruleFor = (entry: { environmentId: EnvironmentId; projectId: ProjectId }) =>
    pullRequestFeedRule(settingsOf(entry.environmentId), entry.projectId);

  // Original spelling, newest last, once per link.
  const hiddenUrls = [
    ...new Map(
      environments
        .flatMap((environment) => environment.serverConfig?.settings.hiddenPullRequests ?? [])
        .map((url) => [url.toLowerCase(), url] as const),
    ).values(),
  ];

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
    runPlan(environments, (current) =>
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
  ) => {
    const api = readLocalApi();
    if (!api) return;
    const isHidden = isPullRequestHidden(hidden, entry.url);
    const rule = ruleFor(entry);
    const rulesSupported =
      environments.find((environment) => environment.environmentId === entry.environmentId)
        ?.serverConfig?.environment.capabilities.projectSettingsOverrides === true;
    const items: ContextMenuItem<FeedMenuAction>[] = [
      { id: "copy-link", label: "Copy link", icon: "copy" },
      { id: "open-external", label: openLabel },
      isHidden
        ? { id: "unhide", label: "Show in feed", separatorBefore: true }
        : { id: "hide", label: "Hide from feed", separatorBefore: true },
      {
        id: "rule:all",
        label: `Feed for ${entry.projectTitle}`,
        disabled: !rulesSupported,
        children: PULL_REQUEST_FEED_RULES.map((option) => ({
          id: `rule:${option.value}` as const,
          label: option.label,
          checked: option.value === rule,
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
      if (picked) setProjectRule(entry, picked.value);
    }
  };

  const showRowMenu: PullRequestRowMenu = useStableCallback((entry, openLabel, position) => {
    void openRowMenu(entry, openLabel, position);
  });

  return { hidden, hiddenUrls, ruleFor, unhide, showRowMenu };
}
