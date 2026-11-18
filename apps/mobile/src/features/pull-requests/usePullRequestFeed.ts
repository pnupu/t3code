import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  hiddenPullRequestList,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  pullRequestFeedRule,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { use, useState } from "react";

import { readEnvironmentScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";
import { useSettingsWriter } from "../settings/useSettingsWriter";
import { shownHiddenList, type PendingHiddenList } from "./pendingHiddenPullRequests";

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const writeSettings = useSettingsWriter();
  const registry = use(RegistryContext);
  const [pending, setPending] = useState<ReadonlyMap<EnvironmentId, PendingHiddenList>>(
    () => new Map(),
  );
  const storedOf = (environmentId: EnvironmentId) =>
    configs.get(environmentId)?.settings.hiddenPullRequests ?? [];
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

  const write = (next: ReadonlyMap<EnvironmentId, ReadonlyArray<string>>) => {
    if (next.size === 0) return;
    setPending((current) => {
      const updated = new Map(current);
      for (const [environmentId, list] of next) updated.set(environmentId, { list });
      return updated;
    });
    void writeSettings(
      [],
      [...next].map(([environmentId, hiddenPullRequests]) => ({
        environmentId,
        patch: { hiddenPullRequests },
      })),
    ).then((failed) => {
      // Read now: this render's settings may already be older than the reply.
      const latest = registry.get(environmentServerConfigsAtom);
      setPending((current) => {
        const updated = new Map(current);
        for (const [environmentId, list] of next) {
          if (updated.get(environmentId)?.list !== list) continue;
          if (failed.includes(environmentId)) updated.delete(environmentId);
          else
            updated.set(environmentId, {
              list,
              savedOver: latest.get(environmentId)?.settings.hiddenPullRequests ?? [],
            });
        }
        return updated;
      });
    });
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

  return { hidden, hiddenUrls, ruleFor, canHide, canUnhide, hide, unhide };
}
