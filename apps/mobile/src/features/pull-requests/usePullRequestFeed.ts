import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  hiddenPullRequestKey,
  hiddenPullRequestLinks,
  isPullRequestHidden,
  pullRequestFeedRule,
  pullRequestProjectHidesRepository,
} from "@t3tools/client-runtime/pull-request-feed";
import { AuthSettingsWriteScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { use, useState } from "react";

import { readEnvironmentScope } from "../../state/session";
import { environmentServerConfigsAtom } from "../../state/server";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { useSettingsWriter } from "../settings/useSettingsWriter";
import { sentHiddenPullRequestApplies, type SentHiddenPullRequest } from "./sentHiddenPullRequests";

/** Per-project feed rules and hidden pull requests, read from every environment's settings. */
export function usePullRequestFeed() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const environments = useWorkspaceEnvironments();
  const writeSettings = useSettingsWriter();
  const registry = use(RegistryContext);
  // Single keys this device sent, shown until the server's settings answer them.
  const [sending, setSending] = useState<ReadonlyMap<string, SentHiddenPullRequest<EnvironmentId>>>(
    () => new Map(),
  );
  const links = new Map(
    hiddenPullRequestLinks([...configs.values()].map((config) => config.settings)),
  );
  const settingsOf = (id: EnvironmentId) => configs.get(id)?.settings;
  for (const [key, sent] of sending) {
    if (!sentHiddenPullRequestApplies(sent, settingsOf)) continue;
    if (sent.url === null) links.delete(key);
    else links.set(key, sent.url);
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
    const sent: SentHiddenPullRequest<EnvironmentId> = { url };
    setSending((current) => {
      // Answered sends never apply again, so they leave here.
      const next = new Map(
        [...current].filter(([, entry]) => sentHiddenPullRequestApplies(entry, settingsOf)),
      );
      return next.set(key, sent);
    });
    void writeSettings(
      [],
      environmentIds.map((environmentId) => ({
        environmentId,
        patch: { hiddenPullRequests: { [key]: url } },
      })),
    ).then((failed) => {
      // Read now: the push may have arrived before this reply.
      const latest = registry.get(environmentServerConfigsAtom);
      setSending((current) => {
        // Only this send's own entry: a later send for the same key replaced it.
        if (current.get(key) !== sent) return current;
        const next = new Map(current);
        if (failed.length > 0) next.delete(key);
        else
          next.set(key, {
            url,
            settledOver: new Map(environmentIds.map((id) => [id, latest.get(id)?.settings])),
          });
        return next;
      });
    });
  };

  const hide = (entry: { readonly environmentId: EnvironmentId; readonly url: string }) => {
    if (canHide(entry.environmentId)) {
      send(hiddenPullRequestKey(entry.url), entry.url, [entry.environmentId]);
    }
  };

  // Every environment that holds the link hides it, so all of them must be able to clear it.
  const holders = (url: string) =>
    [...configs].flatMap(([environmentId, config]) =>
      isPullRequestHidden(new Set(hiddenPullRequestLinks([config.settings]).keys()), url)
        ? [environmentId]
        : [],
    );
  /** The environment that keeps the link hidden because this device cannot clear it there. */
  const unhideBlockedBy = (url: string) => {
    const blocking = holders(url).find(
      (environmentId) =>
        !canHide(environmentId) ||
        !environments.some(
          (environment) =>
            environment.environmentId === environmentId &&
            environment.connectionState === "connected",
        ),
    );
    if (blocking === undefined) return null;
    return (
      environments.find((environment) => environment.environmentId === blocking)
        ?.environmentLabel ?? blocking
    );
  };
  const canUnhide = (url: string) => holders(url).length > 0 && unhideBlockedBy(url) === null;

  const unhide = (url: string) => {
    if (canUnhide(url)) send(hiddenPullRequestKey(url), null, holders(url));
  };

  return {
    hidden,
    hiddenUrls,
    ruleFor,
    hidesRepository,
    canHide,
    canUnhide,
    unhideBlockedBy,
    hide,
    unhide,
  };
}
