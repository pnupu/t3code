import { useAtomValue } from "@effect/atom-react";
import {
  hiddenPullRequestList,
  hiddenPullRequestUrls,
  isPullRequestHidden,
  pullRequestFeedRule,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { readEnvironmentScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";
import { useSettingsWriter } from "../settings/useSettingsWriter";

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const writeSettings = useSettingsWriter();
  // A write replaces the whole list, so the next one must build on it before the server echoes.
  const [pending, setPending] = useState<ReadonlyMap<EnvironmentId, ReadonlyArray<string>>>(
    () => new Map(),
  );
  const hiddenOf = (environmentId: EnvironmentId) =>
    pending.get(environmentId) ?? configs.get(environmentId)?.settings.hiddenPullRequests ?? [];
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
    setPending((current) => new Map([...current, ...next]));
    void writeSettings(
      [],
      [...next].map(([environmentId, hiddenPullRequests]) => ({
        environmentId,
        patch: { hiddenPullRequests },
      })),
    ).finally(() =>
      setPending((current) => {
        const settled = new Map(current);
        for (const [environmentId, list] of next) {
          if (settled.get(environmentId) === list) settled.delete(environmentId);
        }
        return settled;
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

  return { hidden, hiddenUrls, ruleFor, canHide, canUnhide, hide, unhide };
}
