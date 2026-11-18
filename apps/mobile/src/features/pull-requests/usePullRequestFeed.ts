import { useAtomValue } from "@effect/atom-react";
import {
  hiddenPullRequestKey,
  hiddenPullRequestLinks,
  isPullRequestHidden,
  pullRequestFeedRule,
  pullRequestProjectHidesRepository,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useState } from "react";

import { readEnvironmentScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useSettingsWriter } from "../settings/useSettingsWriter";

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const environments = useWorkspaceEnvironments();
  const writeSettings = useSettingsWriter();
  // Single keys still on their way to the server: a URL hides, null shows again.
  const [sending, setSending] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const links = new Map(
    hiddenPullRequestLinks([...configs.values()].map((config) => config.settings)),
  );
  for (const [key, url] of sending) {
    if (url === null) links.delete(key);
    else links.set(key, url);
  }
  const hidden: ReadonlySet<string> = new Set(links.keys());
  const hiddenUrls = [...links.values()];

  const ruleFor = (entry: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }) => pullRequestFeedRule(configs.get(entry.environmentId)?.settings, entry.projectId);

  /** Older servers drop the setting, and a standard pairing cannot write settings. */
  const canHide = (environmentId: EnvironmentId) =>
    configs.get(environmentId)?.environment.capabilities.pullRequestFeed === true &&
    readEnvironmentScope(environmentId, AuthSettingsWriteScope);

  /** The one rule for which projects hide their repository, the same as on web. */
  const hidesRepository = (project: {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }) =>
    pullRequestProjectHidesRepository(
      ruleFor({ environmentId: project.environmentId, projectId: project.id }),
      {
        // As on web: connected, with its server config.
        connected:
          configs.has(project.environmentId) &&
          environments.some(
            (environment) =>
              environment.environmentId === project.environmentId &&
              environment.connectionState === "connected",
          ),
      },
    );

  // One key per write, so concurrent hides and unhides from anywhere cannot erase each other.
  const send = (key: string, url: string | null, environmentIds: ReadonlyArray<EnvironmentId>) => {
    setSending((current) => new Map(current).set(key, url));
    void writeSettings(
      [],
      environmentIds.map((environmentId) => ({
        environmentId,
        patch: { hiddenPullRequests: { [key]: url } },
      })),
    ).finally(() =>
      setSending((current) => {
        if (current.get(key) !== url) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      }),
    );
  };

  const hide = (entry: { readonly environmentId: EnvironmentId; readonly url: string }) => {
    if (canHide(entry.environmentId)) {
      send(hiddenPullRequestKey(entry.url), entry.url, [entry.environmentId]);
    }
  };

  const holders = (url: string) =>
    [...configs].flatMap(([environmentId, config]) =>
      canHide(environmentId) &&
      isPullRequestHidden(new Set(hiddenPullRequestLinks([config.settings]).keys()), url)
        ? [environmentId]
        : [],
    );

  // Every environment that holds the link hides it, so unhiding clears them all.
  const unhide = (url: string) => {
    const environmentIds = holders(url);
    if (environmentIds.length > 0) send(hiddenPullRequestKey(url), null, environmentIds);
  };

  const canUnhide = (url: string) => holders(url).length > 0;

  return { hidden, hiddenUrls, ruleFor, hidesRepository, canHide, canUnhide, hide, unhide };
}
