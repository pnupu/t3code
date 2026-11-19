import type {
  EnvironmentId,
  PullRequestListCursors,
  PullRequestListInput,
} from "@t3tools/contracts";
import { useState } from "react";

import { usePullRequestHostList, type EnvironmentQueryTarget } from "~/state/pullRequests";

import type { PullRequestReadState } from "./pullRequestLoadMore.logic";
import type { EnvironmentPullRequestEntry, MergedPullRequestList } from "./pullRequestList.logic";

export interface PagedHostListRows {
  readonly entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  readonly errors: MergedPullRequestList["errors"];
  readonly answered: ReadonlyArray<EnvironmentId>;
}

/**
 * A secondary list read that pages on its own cursors and adds its pages up, as the main list does.
 * `key` names the question: a new one starts again from the first page.
 */
export function usePagedHostList(
  baseTargets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
  key: string,
  turn: string,
  pageSize: number,
  maxPageSize: number,
) {
  const [page, setPage] = useState<{
    key: string;
    size: number;
    cursors: Readonly<Record<string, PullRequestListCursors>> | null;
    turn: string;
  }>({ key, size: pageSize, cursors: null, turn });
  const size = page.key === key ? page.size : pageSize;
  const cursors = page.key === key ? page.cursors : null;
  const targets = baseTargets.flatMap((target) => {
    const input = { ...target.input, limit: size };
    if (cursors === null) return [{ ...target, input }];
    const sent = cursors[target.environmentId];
    return sent === undefined ? [] : [{ ...target, input: { ...input, cursors: sent } }];
  });
  const query = usePullRequestHostList(targets);

  const [rows, setRows] = useState<
    | (PagedHostListRows & {
        readonly key: string;
        readonly source: MergedPullRequestList;
        readonly nextCursors: Readonly<Record<string, PullRequestListCursors>>;
      })
    | null
  >(null);
  const settled = query.data !== null && !query.isPending ? query.data : null;
  if (settled !== null && (rows?.key !== key || rows.source !== settled)) {
    // A first page that answers again replaces the pages before it.
    const held = cursors !== null && rows?.key === key ? rows : null;
    const byUrl = new Map((held?.entries ?? []).map((entry) => [entry.url, entry]));
    for (const entry of settled.entries) byUrl.set(entry.url, entry);
    setRows({
      key,
      source: settled,
      entries: [...byUrl.values()],
      // A page replaces the errors of the environments it answered.
      errors: [
        ...(held?.errors ?? []).filter((error) => !query.answered.includes(error.environmentId)),
        ...settled.errors,
      ],
      answered: [...new Set([...(held?.answered ?? []), ...query.answered])],
      nextCursors: settled.nextCursors,
    });
  }
  const held = rows?.key === key ? rows : null;
  // A refresh of a later page would strand the pages before it, so the loaded span is asked for
  // again from the start, sized like the main list by the largest environment's count.
  const collapse = () => {
    const counts = new Map<string, number>();
    for (const entry of held?.entries ?? []) {
      counts.set(entry.environmentId, (counts.get(entry.environmentId) ?? 0) + 1);
    }
    const largest = Math.max(0, ...counts.values());
    setPage({
      key,
      size: Math.min(Math.max(pageSize, Math.ceil(largest / pageSize) * pageSize), maxPageSize),
      cursors: null,
      turn,
    });
  };
  if (cursors !== null && page.turn !== turn) collapse();

  const state: PullRequestReadState | null =
    baseTargets.length === 0
      ? null
      : query.isPending
        ? "pending"
        : query.failed.length > 0
          ? "failed"
          : held !== null && Object.keys(held.nextCursors).length > 0
            ? "truncated"
            : "complete";
  const advance = () => {
    if (state === "failed") query.refresh();
    else if (state === "truncated" && held !== null) {
      setPage({ key, size, cursors: held.nextCursors, turn });
    }
  };
  const refresh = () => (cursors === null ? query.refresh() : collapse());
  return { rows: held, state, advance, refresh, failed: query.failed };
}
