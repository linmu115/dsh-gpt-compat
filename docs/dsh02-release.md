# DSH 0.2.0-rc.2 candidate release

Current maintenance candidate: `dsh-gpt-compat@0.5.0-dsh02.2` and optional `dsh-gpt-compat-accounts@0.1.4-dsh02.3`; see [the October 3 maintenance record](maintenance-20261003.md). Both remain private packages distributed as local archives. The required independent host cohort remains `0.2.0-rc.2+gpt-dsh02.1`, based on the actual Launcher 0.2.0-rc.2 distribution and official source `639ed015`. This update does not rebuild that host.

The reproduction instructions and qualification counts below describe the initial September 29 candidate. Launcher deployment of plugin `.1` and Accounts `.2` was subsequently verified on September 30. They must not be read as current installation status or as qualification of this maintenance candidate.

## Reproduce

Prepare pristine official source, a separate source copy with the current patch applied, the actual Launcher distribution, and the plugin development dependencies. Set `DSH_HOST_ROOT` to the patched source, `DSH_HOST_BASELINE` to pristine source, and `DSH_HOST_NODE_MODULES` to the actual distribution's node_modules. `DSH_HOST_OUTPUT` optionally chooses a fresh independent output directory; the default is this repository's `artifacts/host-dsh02`.

```text
node scripts/prepare-host-patch.mjs
node scripts/build-host-candidate.mjs
node scripts/audit-host-candidate.mjs
node scripts/build.mjs
node scripts/package-candidate.mjs
node scripts/qualify-dsh02-artifact.mjs artifacts/host-dsh02/runtime
```

Host compilation uses a complete TypeScript program across the 13 explicit source packages. It performs semantic checks and typed JavaScript/declaration emission, including Cordis const-enum inlining and relative `.ts` to `.js` rewriting, then bundles the emitted JavaScript in the official `lib/types` → `lib` shape. This is not per-file transpilation. The actual distribution supplies every unchanged generated face; no new RPC interface is added by this patch. The source generator changes are the known-event catalog and scoped event declarations.

The independent runtime copies all 288 actual `@deepseek-ai` packages before replacing the 13 changed packages. Unchanged DSH packages therefore resolve the patched cohort from the same tree. Third-party dependencies are read-only links to the locally installed cache and are listed in `assembly.json`; this is a locally runnable candidate, not a network-free portable installer. The initial qualification did not cover a clean-machine install or Launcher deployment.

The package audit imports all rebuilt host entries and checks V4 encoding/current strict restoration of `context/checkpoint`, `context/checkpoint-commit`, `context/operation`, `context/operation-result`, and `request/projection`. The same fixture is rejected by the official stock catalog. `audit.json`, `assembly.json`, the patch hash manifest, package hashes and local `.tgz` files are the reviewable evidence. Maintenance must select a separate GPT-capable V4 dialect; do not relax the stock V4 reader.

## Initial qualification boundary (September 29)

The final source suite passed 91 tests with one explicitly skipped live-model test. Typed compilation, classic-script client factory registration and isolated host imports passed. Two plain Node processes also loaded the packaged plugins and independent host: a local synthetic Responses server triggered an actual file patch and compaction, events were encoded with the V4 catalog and strictly restored in the second process, and the opaque checkpoint survived without re-executing the tool. This fixture prohibits live-provider mode. Its receipt is `runtime/qualification.json`.

Existing shell/fs broad regressions include Windows symlink permission and WSL environment failures recorded in the initial maintenance report; they are not reported as passing. That initial qualification did not repeat earlier 0.1.5 live-provider checks or install into an existing profile. Later deployment and acceptance are recorded separately. The development lockfile records dependency resolution only; clean-machine dependency installation has not been qualified, and local compilation used the recorded installed SDK/toolchain.
