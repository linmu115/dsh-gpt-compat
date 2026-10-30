# RC3 / Windows and macOS candidate

Version: `0.6.0-dsh021rc3.1`. Target: official `0.2.1-rc.3`, tag commit `1f81c047fc48fa190a683e469daa699857e9afe8`.

Ports the existing 13-package host extension to official RC3. Local CPA supports native Windows and macOS executables; macOS checks execute permission and reads exact kernel argv, preserving spaces, Unicode and case. Windows retains CommandLineToArgvW. Koffi is loaded only on macOS. Existing-process ambiguity prevents a duplicate launch. Bash/PowerShell integration fixtures select the native platform shell.

One source branch and one package are maintained for both operating systems. Build and regression checks run on Apple Silicon macOS. Windows-specific native checks are to be run on Windows; platform-independent Windows path, quoting and launch decisions are covered locally. UI operations in the user's live profile and Vault remain a separate acceptance step.

Build with Node 24, the repository package manager, and the exact RC3 host source. For the three Core/Bridge/Sticker packages, run `prepare:host` against the built official source before build/typecheck/test. Build in order: Core, Bridge, Sticker. The Obsidian companion vendors its protocol and Core package archives for reproducibility.

## Independent GPT host

GPT Compat requires the patched host; installing only the plugin on stock Desktop does not provide the extension events and shell APIs. Keep existing user sessions on their original runtime. The patch manifest records source hashes and the exact RC3 base.

1. Place pristine RC3 source in `../host-baseline` and a separate copy in `../host-gpt-candidate`.
2. Apply `host-patches/dsh-0.2.1-rc.3-gpt-dsh021rc3.1.patch` to the candidate, install its locked dependencies, run `build:artifacts` and `build:check`.
3. Run `npm ci --legacy-peer-deps`, `node scripts/link-candidate-deps.mjs`, `npm run build`, `npm test`, and `npm run build:host`.
4. Set `DSH_HOST_BASELINE` to the pristine source and run `npm run audit:host`. This audits V4 extension-event restore and confirms stock readers reject those extensions.
5. Set `NPM_CLI_JS` to npm's `bin/npm-cli.js`, then run `node scripts/package-candidate.mjs`. Install runtime dependencies, including `koffi`, when assembling a portable runtime. The development runtime uses dependency-cache symlinks and is not a portable distribution.

`npm run test:platform` exercises path handling, launch locking, exact process arguments and platform-native fixtures. Native macOS Koffi loading was also exercised with the installed RC3 Electron host executable. The independently signed standalone Node in Desktop has a different native-library policy; do not use it as a substitute for the Electron host.

Installed Desktop reports RC3 with build commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`; the public tag has the commit above. Source qualification uses that public tag. Stock and patched profile boot checks use fresh temporary homes and do not load user history or Vault bindings.
