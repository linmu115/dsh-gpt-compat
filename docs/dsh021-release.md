# DSH 0.2.1-rc.2 local release

GPT Compat 0.6.0-dsh021.1 and Accounts 0.1.4-dsh021.1 target exactly DSH 0.2.1-rc.2. They retain the deployed streaming, native Responses/codex-v2 compaction, tool replay protection, fixed-account, authentication diagnostics and account-card re-login behavior.

The required host patch is gpt-dsh021.1 against commit 687f282e8625c6b8d11ff58211a90524be2e4317. It modifies 13 host packages, including the JSONL construction exports used by Session Maintenance. The upstream JSONL apply lifecycle remains intact. Removed upstream invariant/scoped-events modules are not restored.

Use one candidate Cordis 4.0.5, Schemastery 3.18.5, CosmoKit 1.8.6 and Loader 1.0.6 instance. Production routing remains codex-v2 and local automatic context management defaults to off. Accounts resolves credentials through the current host service; stored credentials take precedence over inherited environment values.

Verification: 190 backend and 38 UI regression tests passed, one optional live test skipped. The patched runtime imports all 13 packages and strictly restores V4 native context events. The official unpatched reader rejects those required events. Installation, real OAuth, real model requests and browser interaction are separate acceptance steps.

The release directory contains plugin archives, a host overlay, source patch/manifest and deployment instructions. The host and plugin form one release; install while the exact target instance is stopped through the Launcher and keep the original official version available.

## Developer source directories

Use two separate source checkouts at official commit `687f282e8625c6b8d11ff58211a90524be2e4317`: a pristine baseline and a candidate with the published host patch applied. Place the candidate at `../host-gpt-candidate` beside this plugin checkout. The checked-in TypeScript aliases use that relative layout.

Set `DSH_HOST_BASELINE` explicitly to the pristine official `0.2.1-rc.2` source directory before running `prepare-host-patch.mjs` or `audit-host-candidate.mjs`. There is no personal Launcher-path default. The audit also requires the baseline's built `packages/session/session-format-catalog/lib/index.js`. Keep that baseline read-only; install dependencies and build the candidate in its separate directory. This release is based on source packages, not an older npm host package.

```powershell
$env:DSH_HOST_BASELINE = (Resolve-Path '../host-baseline').Path
$env:DSH_HOST_ROOT = (Resolve-Path '../host-gpt-candidate').Path
node scripts/link-candidate-deps.mjs
node scripts/configure-compat02.mjs
npm run typecheck
```

`DSH_HOST_ROOT` defaults to the sibling `host-gpt-candidate`. If a different candidate location is needed, set it before configuring; generated aliases are relative to each configuration file. `configure-compat02.mjs` writes development configuration and dependency links in the plugin and candidate only. Both source trees must already have their required development dependencies available. The baseline is used solely for source comparison and the stock codec audit.
