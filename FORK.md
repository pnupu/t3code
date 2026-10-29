# pnupu/t3code

Upstream T3 Code stable releases plus a few fork commits. `main` is always an upstream
stable tag with the fork commits rebased on top, so it is force-pushed on every sync.

## How a release reaches the machines

1. `scripts/fork/sync.sh` rebases `main` onto the newest upstream stable tag and pushes.
   A T3 Code scheduled task on serveri runs it and resolves conflicts.
2. Every push to `main` runs `.github/workflows/fork-release.yml`: typecheck, the tests
   beside fork changes, a Linux x64 desktop build and CLI archive, and a macOS arm64 build
   re-signed with the fork's self-signed identity. It publishes `vX.Y.(Z*1000+n)`, so
   upstream `v0.1.4` becomes `0.1.4001`, `0.1.4002`, and so on.
3. The desktop app offers the release; its update button moves every connected server.

A conflict or a failed release opens a `fork-sync` issue and publishes nothing, so
machines stay on the last release.

## Installing on a new machine

Linux server (runs the background service):

```sh
curl -fsSL https://raw.githubusercontent.com/pnupu/t3code/main/scripts/install.sh | sh
```

Mac: download `T3-Code-<version>-arm64.zip` from the latest release with `curl` and unzip
it into `/Applications`. A browser download is quarantined and needs Open Anyway in
System Settings → Privacy & Security once. Later updates come through the app.

Update from the fork's desktop app or the web UI a fork server serves. app.t3.codes and
the iPhone app look for upstream versions, which fork servers cannot install.

## Adding a fork feature

- One commit per feature, with its tests beside the code, so the release checks catch a
  sync that broke it.
- Put the code in new files and keep edits to busy upstream files to a line or two.
- No database migrations: upstream numbers them sequentially.
- Offer the feature upstream too; once it lands there, drop the commit.
