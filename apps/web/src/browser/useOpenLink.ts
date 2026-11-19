import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { recordVisitForThread } from "~/browserHistoryStore";
import { readLocalApi } from "~/localApi";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  canOpenLinkIn,
  type LinkClickModifiers,
  resolveLinkTarget,
  resolveLinkTargetSettings,
} from "./browserLinkTarget";
import { isBrowserSettingsReadError, openUrlInPreview } from "./openFileInPreview";

const NO_MODIFIER = { metaKey: false, ctrlKey: false } as const;

/** Rejects on settings read failure without opening a browser, or if the system-browser fallback fails. */
export function useOpenLink(threadRef: ScopedThreadRef | null | undefined): (
  url: string,
  options?: {
    readonly event?: LinkClickModifiers;
    readonly threadRef?: ScopedThreadRef | undefined;
  },
) => Promise<void> {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return async (url, options = {}) => {
    const targetThreadRef = options.threadRef ?? threadRef;
    const target = resolveLinkTarget({
      url,
      event: options.event ?? NO_MODIFIER,
      settings: await resolveLinkTargetSettings(),
      canOpenIn: (inAppTarget) => canOpenLinkIn(targetThreadRef, inAppTarget),
    });
    if (target !== "system" && targetThreadRef) {
      const result = await openUrlInPreview({
        threadRef: targetThreadRef,
        url,
        openPreview,
        target,
      });
      if (isAtomCommandInterrupted(result)) return;
      if (result._tag === "Success") {
        recordVisitForThread(targetThreadRef, url);
        return;
      }
      const failure = squashAtomCommandFailure(result);
      if (isBrowserSettingsReadError(failure)) throw failure;
      console.error(result.cause);
    }
    const api = readLocalApi();
    if (!api) throw new Error("Link opening is unavailable.");
    await api.shell.openExternal(url);
  };
}
