import { sign } from "@electron/osx-sign";

const [app, identity, keychain] = process.argv.slice(2);
if (!app || !identity || !keychain) {
  throw new Error("usage: sign-macos-app.ts <app> <identity> <keychain>");
}

await sign({
  app,
  identity,
  keychain,
  platform: "darwin",
  // Self-signed and never notarized: skip Developer ID checks, Apple's timestamp server,
  // the hardened runtime, and the entitlements only it needs.
  identityValidation: false,
  preAutoEntitlements: false,
  preEmbedProvisioningProfile: false,
  batchCodesignCalls: true,
  optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
});
