import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

/** Moves a thread to another project on its server and reports a refusal in a toast. */
export function useMoveThreadToProject() {
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  return async (threadRef: ScopedThreadRef, projectId: ProjectId) => {
    const result = await updateThreadMetadata({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, projectId },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Could not move the thread")),
          description:
            thrownErrorMessage(squashAtomCommandFailure(result), m) ?? m(msg("An error occurred.")),
        }),
      );
    }
  };
}
