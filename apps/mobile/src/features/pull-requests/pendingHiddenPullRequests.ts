/** A save of an environment's hidden list, which replaces the whole list. */
export interface PendingHiddenList {
  readonly list: ReadonlyArray<string>;
  /** The stored list when the save succeeded; until the subscription replaces it, the save is newer. */
  readonly savedOver?: ReadonlyArray<string>;
}

/** The list later hides and unhides build on: a save in flight or not yet echoed wins. */
export function shownHiddenList(
  stored: ReadonlyArray<string>,
  pending: PendingHiddenList | undefined,
): ReadonlyArray<string> {
  if (pending === undefined) return stored;
  return pending.savedOver === undefined || pending.savedOver === stored ? pending.list : stored;
}
