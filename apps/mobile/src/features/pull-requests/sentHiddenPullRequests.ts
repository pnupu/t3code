/** A hide or unhide this device sent: the URL hides the link, null shows it again. */
export interface SentHiddenPullRequest<Id extends string = string> {
  readonly url: string | null;
  /** Each target environment's settings when the save succeeded. */
  readonly settledOver?: ReadonlyMap<Id, unknown>;
}

/** It shows until every target environment's settings change after the save, confirming it. */
export function sentHiddenPullRequestApplies<Id extends string>(
  sent: SentHiddenPullRequest<Id>,
  settingsOf: (environmentId: Id) => unknown,
): boolean {
  return (
    sent.settledOver === undefined ||
    [...sent.settledOver].some(
      ([environmentId, settings]) => settingsOf(environmentId) === settings,
    )
  );
}
