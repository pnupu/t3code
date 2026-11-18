import { useAtomValue } from "@effect/atom-react";
import {
  hiddenPullRequestUrls,
  pullRequestFeedRule,
  withHiddenPullRequest,
  withoutHiddenPullRequest,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";

import { readEnvironmentScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";
import { useSettingsWriter } from "../settings/useSettingsWriter";

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const writeSettings = useSettingsWriter();
  const settings = [...configs.values()].map((config) => config.settings);
  const hidden = hiddenPullRequestUrls(settings);
  // Original spelling, once per link.
  const hiddenUrls = [
    ...new Map(
      settings.flatMap((entry) => entry.hiddenPullRequests).map((url) => [url.toLowerCase(), url]),
    ).values(),
  ];

  const ruleFor = (entry: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }) => pullRequestFeedRule(configs.get(entry.environmentId)?.settings, entry.projectId);

  const canHide = (environmentId: EnvironmentId) =>
    configs.has(environmentId) && readEnvironmentScope(environmentId, AuthSettingsWriteScope);

  const hide = (entry: { readonly environmentId: EnvironmentId; readonly url: string }) => {
    const current = configs.get(entry.environmentId)?.settings;
    if (!current || !canHide(entry.environmentId)) return;
    void writeSettings(
      [],
      [
        {
          environmentId: entry.environmentId,
          patch: {
            hiddenPullRequests: withHiddenPullRequest(current.hiddenPullRequests, entry.url),
          },
        },
      ],
    );
  };

  // Every environment that holds the link hides it, so unhiding clears them all.
  const unhide = (url: string) =>
    void writeSettings(
      [],
      [...configs].flatMap(([environmentId, config]) => {
        const next = withoutHiddenPullRequest(config.settings.hiddenPullRequests, url);
        return next.length === config.settings.hiddenPullRequests.length || !canHide(environmentId)
          ? []
          : [{ environmentId, patch: { hiddenPullRequests: next } }];
      }),
    );

  return { hidden, hiddenUrls, ruleFor, canHide, hide, unhide };
}
