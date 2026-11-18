import { useAtomValue } from "@effect/atom-react";
import {
  hiddenPullRequestList,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  pullRequestFeedRule,
  pullRequestProjectHidesRepository,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { readEnvironmentScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";
import { useWorkspaceState } from "../../state/workspace";
import { useSettingsWriter } from "../settings/useSettingsWriter";
import {
  settledHiddenSaves,
  shownHiddenList,
  type PendingHiddenList,
} from "./pendingHiddenPullRequests";

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const writeSettings = useSettingsWriter();
  const [pending, setPending] = useState<ReadonlyMap<EnvironmentId, PendingHiddenList>>(
    () => new Map(),
  );
  const storedOf = (environmentId: EnvironmentId) =>
    configs.get(environmentId)?.settings.hiddenPullRequests ?? [];
  const settled = settledHiddenSaves(pending, storedOf);
  if (settled.length > 0) {
    setPending((current) => {
      const updated = new Map(current);
      for (const environmentId of settled) updated.delete(environmentId);
      return updated;
    });
  }
  const hiddenOf = (environmentId: EnvironmentId) =>
    shownHiddenList(storedOf(environmentId), pending.get(environmentId));
  const lists = [...configs.keys()].map((environmentId) => ({
    hiddenPullRequests: hiddenOf(environmentId),
  }));
  const hidden = hiddenPullRequestUrls(lists);
  const hiddenUrls = hiddenPullRequestList(lists);

  const ruleFor = (entry: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }) => pullRequestFeedRule(configs.get(entry.environmentId)?.settings, entry.projectId);

  /** Older servers drop the list, and a standard pairing cannot write settings. */
  const canHide = (environmentId: EnvironmentId) =>
    configs.get(environmentId)?.environment.capabilities.pullRequestFeed === true &&
    readEnvironmentScope(environmentId, AuthSettingsWriteScope);

  const { environments } = useWorkspaceState();
  /** The one rule for which projects hide their repository, the same as on web. */
  const hidesRepository = (project: {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }) =>
    pullRequestProjectHidesRepository(
      ruleFor({ environmentId: project.environmentId, projectId: project.id }),
      {
        connected: environments.some(
          (environment) =>
            environment.environmentId === project.environmentId &&
            environment.connectionState === "connected",
        ),
        writable: canHide(project.environmentId),
      },
    );

  const write = (next: ReadonlyMap<EnvironmentId, ReadonlyArray<string>>) => {
    if (next.size === 0) return;
    setPending((current) => {
      const updated = new Map(current);
      for (const [environmentId, list] of next)
        updated.set(environmentId, {
          list,
          sentOver: current.get(environmentId)?.sentOver ?? storedOf(environmentId),
        });
      return updated;
    });
    void writeSettings(
      [],
      [...next].map(([environmentId, hiddenPullRequests]) => ({
        environmentId,
        patch: { hiddenPullRequests },
      })),
    )
      // A rejected write saved nothing either.
      .catch(() => [...next.keys()])
      .then((failed) =>
        setPending((current) => {
          const updated = new Map(current);
          for (const [environmentId, list] of next) {
            if (failed.includes(environmentId) && updated.get(environmentId)?.list === list)
              updated.delete(environmentId);
          }
          return updated;
        }),
      );
  };

  const hide = (entry: { readonly environmentId: EnvironmentId; readonly url: string }) => {
    if (!canHide(entry.environmentId)) return;
    write(
      new Map([
        [entry.environmentId, withHiddenPullRequest(hiddenOf(entry.environmentId), entry.url)],
      ]),
    );
  };

  const holders = (url: string) =>
    [...configs.keys()].filter(
      (environmentId) =>
        canHide(environmentId) &&
        isPullRequestHidden(
          hiddenPullRequestUrls([{ hiddenPullRequests: hiddenOf(environmentId) }]),
          url,
        ),
    );

  // Every environment that holds the link hides it, so unhiding clears them all.
  const unhide = (url: string) =>
    write(
      new Map(
        holders(url).map((environmentId) => [
          environmentId,
          withoutHiddenPullRequest(hiddenOf(environmentId), url),
        ]),
      ),
    );

  const canUnhide = (url: string) => holders(url).length > 0;

  return { hidden, hiddenUrls, ruleFor, hidesRepository, canHide, canUnhide, hide, unhide };
}
