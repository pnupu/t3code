import type { ProjectId, PullRequestFeedRule } from "@t3tools/contracts";

type FeedSettings = {
  readonly projectSettingsOverrides: Readonly<
    Record<string, { readonly pullRequestFeed?: PullRequestFeedRule } | undefined>
  >;
};

/** One project override a pick sent; an undefined rule clears it. */
export interface SentFeedRule<Id extends string = string> {
  readonly environmentId: Id;
  readonly projectId: ProjectId;
  readonly rule: PullRequestFeedRule | undefined;
  /** Set once the server saved it: the settings this device held at that moment. */
  readonly repliedOver?: FeedSettings | undefined;
}

/**
 * The sent overrides still unanswered. One is answered when its settings show the sent rule,
 * whenever that arrived (a no-op save included), or by any settings update after its reply.
 * A failed save is dropped at its reply, and one without settings (offline) is closed, so neither
 * keeps the list locked.
 */
export function openSentFeedRules<Id extends string>(
  sent: ReadonlyArray<SentFeedRule<Id>>,
  settingsOf: (environmentId: Id) => FeedSettings | undefined,
): ReadonlyArray<SentFeedRule<Id>> {
  return sent.filter((write) => {
    const settings = settingsOf(write.environmentId);
    if (settings === undefined) return false;
    if (settings.projectSettingsOverrides[write.projectId]?.pullRequestFeed === write.rule) {
      return false;
    }
    return !("repliedOver" in write) || settings === write.repliedOver;
  });
}
