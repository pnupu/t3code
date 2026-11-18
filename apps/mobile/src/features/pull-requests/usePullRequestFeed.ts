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
import { settleSentHiddenPullRequest, type SentHiddenPullRequest } from "./sentHiddenPullRequests";

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
  // Answered targets leave state for good, so a later change cannot revive them.
  let settled = sending;
  for (const [key, sent] of sending) {
    const next = settleSentHiddenPullRequest(sent, key, settingsOf);
    if (next === sent) continue;
    if (settled === sending) settled = new Map(sending);
    if (next === null) (settled as Map<string, typeof sent>).delete(key);
    else (settled as Map<string, typeof sent>).set(key, next);
  }
  if (settled !== sending) setSending(settled);
  for (const [key, sent] of settled) {
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

  /** As on web: connected, with its server config. */
  const isConnected = (environmentId: EnvironmentId) =>
    configs.has(environmentId) &&
    environments.some(
      (environment) =>
        environment.environmentId === environmentId && environment.connectionState === "connected",
    );

  /** The one rule for which projects hide their repository, the same as on web. */
  const hidesRepository = (project: {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }) =>
    pullRequestProjectHidesRepository(
      ruleFor({ environmentId: project.environmentId, projectId: project.id }),
      { connected: isConnected(project.environmentId) },
    );

  // One key per write, so concurrent hides and unhides from anywhere cannot erase each other.
  const send = (key: string, url: string | null, environmentIds: ReadonlyArray<EnvironmentId>) => {
    const token = {};
    setSending((current) =>
      new Map(current).set(key, {
        token,
        url,
        targets: new Map(environmentIds.map((id) => [id, {}])),
      }),
    );
    void writeSettings(
      [],
      environmentIds.map((environmentId) => ({
        environmentId,
        patch: { hiddenPullRequests: { [key]: url } },
      })),
    ).then((failed) => {
      // Read now: a push that arrived before this reply already answers its target.
      const latest = registry.get(environmentServerConfigsAtom);
      setSending((current) => {
        // Only this send's own entry: a later send for the same key replaced it.
        const entry = current.get(key);
        if (entry?.token !== token) return current;
        const next = new Map(current);
        // A failed holder still hides the link, so the whole send ends.
        if (failed.length > 0) next.delete(key);
        else
          next.set(key, {
            ...entry,
            targets: new Map(
              [...entry.targets.keys()].map((id) => [
                id,
                { repliedOver: latest.get(id)?.settings },
              ]),
            ),
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
    isConnected,
    hidesRepository,
    canHide,
    canUnhide,
    unhideBlockedBy,
    hide,
    unhide,
  };
}
