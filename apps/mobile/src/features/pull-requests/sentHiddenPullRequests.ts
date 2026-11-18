/** A hide or unhide this device sent: the URL hides the link, null shows it again. */
export interface SentHiddenPullRequest {
  readonly url: string | null;
  /** Each target environment's settings when the save succeeded. */
  readonly settledOver?: ReadonlyMap<string, unknown>;
}

/** It shows until a target environment's settings change after the save, confirming or superseding it. */
export function sentHiddenPullRequestApplies(
  sent: SentHiddenPullRequest,
  settingsOf: (environmentId: string) => unknown,
): boolean {
  return (
    sent.settledOver === undefined ||
    [...sent.settledOver].every(
      ([environmentId, settings]) => settingsOf(environmentId) === settings,
    )
  );
}
