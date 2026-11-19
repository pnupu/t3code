import {
  AuthPreviewOperateScope,
  type BrowserLinkTarget,
  type BrowserModifiedLinkTarget,
  type ClientSettings,
  type PreviewRuntime,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import {
  ensureClientSettingsHydrated,
  getClientSettings,
  useClientSettings,
} from "~/hooks/useSettings";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { readEnvironmentSupportsServerBrowser } from "~/state/entities";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { readEnvironmentScope } from "~/state/session";
import { isPreviewAvailableFor, previewRuntimeFor } from "./previewRuntime";
import { isWebUrl } from "./webUrl";

/** "app" follows the plain-click default; "local" and "environment" pick the browser's machine. */
export type InAppLinkTarget = "app" | Exclude<BrowserModifiedLinkTarget, "system">;
export type LinkTarget = "system" | InAppLinkTarget;

export type LinkTargetSettings = Pick<
  ClientSettings,
  "browserLinkTarget" | "browserModClickLinkTarget" | "browserModShiftClickLinkTarget"
>;

export interface LinkClickModifiers {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly button?: number | undefined;
}

export interface ResolveLinkTargetInput {
  readonly url: string;
  readonly event: LinkClickModifiers;
  readonly settings: LinkTargetSettings;
  readonly canOpenIn: (target: InAppLinkTarget) => boolean;
}

export function resolveLinkTarget(input: ResolveLinkTargetInput): LinkTarget {
  if (input.event.button === 1 || !isWebUrl(input.url)) return "system";
  const modified = input.event.metaKey || input.event.ctrlKey;
  // Desktop link routers read a held Alt from the system browser open.
  if (modified && input.event.altKey) return "system";
  const target: BrowserLinkTarget | BrowserModifiedLinkTarget = !modified
    ? input.settings.browserLinkTarget
    : input.event.shiftKey
      ? input.settings.browserModShiftClickLinkTarget
      : input.settings.browserModClickLinkTarget;
  if (target === "system" || !input.canOpenIn(target)) return "system";
  return target;
}

/** For click handlers that must decide synchronously whether to keep the anchor's native open. */
export function useLinkTargetSettings(): LinkTargetSettings {
  const browserLinkTarget = useClientSettings((settings) => settings.browserLinkTarget);
  const browserModClickLinkTarget = useClientSettings(
    (settings) => settings.browserModClickLinkTarget,
  );
  const browserModShiftClickLinkTarget = useClientSettings(
    (settings) => settings.browserModShiftClickLinkTarget,
  );
  return { browserLinkTarget, browserModClickLinkTarget, browserModShiftClickLinkTarget };
}

/** Before hydration, the defaults would ignore saved link targets. */
export async function resolveLinkTargetSettings(): Promise<LinkTargetSettings> {
  await ensureClientSettingsHydrated();
  return getClientSettings();
}

/** `null` means the target has no integrated browser for this thread. */
export function previewRuntimeForLinkTarget(
  threadRef: ScopedThreadRef,
  target: InAppLinkTarget,
): PreviewRuntime | undefined | null {
  const { environmentId } = threadRef;
  const isPrimary = environmentId === appAtomRegistry.get(primaryEnvironmentIdAtom);
  switch (target) {
    case "app":
      return previewRuntimeFor(environmentId);
    case "local":
      // The primary environment's server browser runs on this machine and renders natively.
      if (!isPreviewSupportedInRuntime()) return null;
      return isPrimary ? previewRuntimeFor(environmentId) : undefined;
    case "environment":
      if (readEnvironmentSupportsServerBrowser(environmentId)) return "server";
      return isPrimary && isPreviewSupportedInRuntime() ? undefined : null;
  }
}

export function canOpenLinksInApp(threadRef: ScopedThreadRef | null | undefined): boolean {
  return (
    threadRef != null &&
    readEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope) &&
    isPreviewAvailableFor(threadRef.environmentId)
  );
}

export function canOpenLinkIn(
  threadRef: ScopedThreadRef | null | undefined,
  target: InAppLinkTarget,
): boolean {
  return (
    threadRef != null &&
    threadRef.threadId.length > 0 &&
    canOpenLinksInApp(threadRef) &&
    previewRuntimeForLinkTarget(threadRef, target) !== null
  );
}
