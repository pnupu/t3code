type HiddenSettings = { readonly hiddenPullRequests: Readonly<Record<string, string>> };

/** A hide or unhide this device sent: the URL hides the link, null shows it again. */
export interface SentHiddenPullRequest<Id extends string = string> {
  /** Stays the same while targets settle, so the save's reply finds its own entry. */
  readonly token: object;
  readonly url: string | null;
  /** Targets still unanswered; once replied, the settings the reply found. */
  readonly targets: ReadonlyMap<Id, { readonly repliedOver?: HiddenSettings | undefined }>;
}

/**
 * Drops the answered targets, for good: a target is answered when its settings already show the
 * sent state, whenever that arrived, or by any settings update after a successful reply. Returns
 * the same entry when nothing changed, and null when every target is answered.
 */
export function settleSentHiddenPullRequest<Id extends string>(
  sent: SentHiddenPullRequest<Id>,
  key: string,
  settingsOf: (environmentId: Id) => HiddenSettings | undefined,
): SentHiddenPullRequest<Id> | null {
  const open = [...sent.targets].filter(([environmentId, target]) => {
    const settings = settingsOf(environmentId);
    const holds =
      settings !== undefined &&
      Object.keys(settings.hiddenPullRequests).some((stored) => stored.toLowerCase() === key);
    if (settings !== undefined && holds === (sent.url !== null)) return false;
    return !("repliedOver" in target) || settings === target.repliedOver;
  });
  if (open.length === sent.targets.size) return sent;
  return open.length === 0 ? null : { ...sent, targets: new Map(open) };
}
