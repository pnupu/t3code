/** A save of an environment's hidden list, which replaces the whole list. */
export interface PendingHiddenList {
  readonly list: ReadonlyArray<string>;
  /** The stored list when the save was sent. */
  readonly sentOver: ReadonlyArray<string>;
}

// By content: a settings re-emit for another reason rebuilds the array without changing it.
const sameList = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((url, index) => url === right[index]);

/** The list later hides and unhides build on: a save the server has not answered yet wins. */
export function shownHiddenList(
  stored: ReadonlyArray<string>,
  pending: PendingHiddenList | undefined,
): ReadonlyArray<string> {
  return pending !== undefined && sameList(pending.sentOver, stored) ? pending.list : stored;
}

/** Saves the server has since confirmed or superseded; none may outlive the next update. */
export function settledHiddenSaves<Key>(
  pending: ReadonlyMap<Key, PendingHiddenList>,
  storedOf: (key: Key) => ReadonlyArray<string>,
): ReadonlyArray<Key> {
  return [...pending].flatMap(([key, save]) =>
    sameList(save.sentOver, storedOf(key)) ? [] : [key],
  );
}
