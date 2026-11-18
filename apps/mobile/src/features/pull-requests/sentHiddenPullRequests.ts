type HiddenSettings = { readonly hiddenPullRequests: Readonly<Record<string, string>> };

/** A hide or unhide this device sent: the URL hides the link, null shows it again. */
export interface SentHiddenPullRequest<Id extends string = string> {
  readonly url: string | null;
  /** Targets still unanswered; once replied, the settings the reply found. */
  readonly targets: ReadonlyMap<Id, { readonly repliedOver?: HiddenSettings | undefined }>;
}

/**
 * It shows while any target is unanswered. A target is answered when its settings already show
 * the sent state, whenever that arrived, or by any settings update after a successful reply.
 * A failed reply removes the target.
 */
export function sentHiddenPullRequestApplies<Id extends string>(
  sent: SentHiddenPullRequest<Id>,
  key: string,
  settingsOf: (environmentId: Id) => HiddenSettings | undefined,
): boolean {
  return [...sent.targets].some(([environmentId, target]) => {
    const settings = settingsOf(environmentId);
    if (
      settings !== undefined &&
      Object.hasOwn(settings.hiddenPullRequests, key) === (sent.url !== null)
    ) {
      return false;
    }
    return !("repliedOver" in target) || settings === target.repliedOver;
  });
}
