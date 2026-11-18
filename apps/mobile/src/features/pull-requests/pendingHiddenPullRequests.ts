/** A save of an environment's hidden list, which replaces the whole list. */
export interface PendingHiddenList {
  readonly list: ReadonlyArray<string>;
  /** The stored list it was sent over, then each earlier save of the chain still unanswered. */
  readonly before: ReadonlyArray<ReadonlyArray<string>>;
}

// By content: a settings re-emit for another reason rebuilds the array without changing it.
const sameList = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((url, index) => url === right[index]);

const answered = (save: PendingHiddenList, stored: ReadonlyArray<string>) =>
  !save.before.some((list) => sameList(list, stored));

/** A save sent while another is unanswered builds on it, so the earlier echo cannot end it. */
export function chainHiddenSave(
  list: ReadonlyArray<string>,
  stored: ReadonlyArray<string>,
  pending: PendingHiddenList | undefined,
): PendingHiddenList {
  return { list, before: pending === undefined ? [stored] : [...pending.before, pending.list] };
}

/** The list later hides and unhides build on: a save the server has not answered yet wins. */
export function shownHiddenList(
  stored: ReadonlyArray<string>,
  pending: PendingHiddenList | undefined,
): ReadonlyArray<string> {
  return pending !== undefined && !answered(pending, stored) ? pending.list : stored;
}

/** Saves the server has since confirmed or superseded; none may outlive that update. */
export function settledHiddenSaves<Key>(
  pending: ReadonlyMap<Key, PendingHiddenList>,
  storedOf: (key: Key) => ReadonlyArray<string>,
): ReadonlyArray<Key> {
  return [...pending].flatMap(([key, save]) => (answered(save, storedOf(key)) ? [key] : []));
}
