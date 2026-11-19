import type { PullRequestListCursors, PullRequestListInput } from "@t3tools/contracts";
import { useState } from "react";

import { usePullRequestHostList, type EnvironmentQueryTarget } from "~/state/pullRequests";

import {
  mergePagedListing,
  nextPagedSend,
  pagedListingState,
  type PagedListing,
  type PagedListingSend,
} from "./pullRequestLoadMore.logic";
import type { EnvironmentPullRequestEntry, MergedPullRequestList } from "./pullRequestList.logic";

type Cursors = PullRequestListCursors;

/**
 * A secondary list read that pages each environment on its own cursors and adds its pages up, as
 * the main list does. `key` names the question: a new one starts again from the first page.
 */
export function usePagedHostList(
  baseTargets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
  key: string,
  turn: string,
  pageSize: number,
) {
  const [page, setPage] = useState<{ key: string; sent: PagedListingSend<Cursors>; turn: string }>({
    key,
    sent: null,
    turn,
  });
  const sent = page.key === key ? page.sent : null;
  const targets = baseTargets.flatMap((target) => {
    const input = { ...target.input, limit: pageSize };
    if (sent === null) return [{ ...target, input }];
    if (!(target.environmentId in sent)) return [];
    const cursors = sent[target.environmentId];
    return [{ ...target, input: cursors == null ? input : { ...input, cursors } }];
  });
  const query = usePullRequestHostList(targets);

  const [rows, setRows] = useState<
    | (PagedListing<
        EnvironmentPullRequestEntry,
        MergedPullRequestList["errors"][number],
        Cursors
      > & { readonly key: string; readonly source: MergedPullRequestList })
    | null
  >(null);
  const settled = query.data !== null && !query.isPending ? query.data : null;
  if (settled !== null && (rows?.key !== key || rows.source !== settled)) {
    setRows({
      key,
      source: settled,
      ...mergePagedListing(
        rows?.key === key ? rows : null,
        {
          entries: settled.entries,
          errors: settled.errors,
          answered: query.answered,
          nextCursors: settled.nextCursors,
        },
        sent,
      ),
    });
  }
  const held = rows?.key === key ? rows : null;
  // A turn or refresh reads the first page again; the pages loaded before it stay.
  const restart = () => setPage({ key, sent: null, turn });
  if (sent !== null && page.turn !== turn) restart();

  const nextCursors = held?.nextCursors ?? {};
  const state = pagedListingState({
    active: baseTargets.length > 0,
    pending: query.isPending,
    failed: query.failed,
    nextCursors,
  });
  const failedTargets = () =>
    targets.filter((target) => query.failed.includes(target.environmentId));
  const advance = () => {
    if (state !== "truncated" && state !== "failed") return;
    if (query.failed.length > 0) query.refresh(failedTargets());
    setPage({ key, sent: nextPagedSend(nextCursors, query.failed, sent), turn });
  };
  const refresh = () => (sent === null ? query.refresh() : restart());
  return {
    rows: held,
    state,
    advance,
    refresh,
    failed: query.failed,
  };
}
