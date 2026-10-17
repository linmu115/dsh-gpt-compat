# Host patch for DSH 0.2.1-rc.2

The current patch is `dsh-0.2.1-rc.2-gpt-dsh021.1.patch`, based on official commit `687f282e8625c6b8d11ff58211a90524be2e4317`. Its manifest records exact source changes and a clean apply check. The 0.2.0 patch is retained as historical source only.

Required capabilities: scoped prompt preparation and route selection; durable request projections and native compaction; guarded single-file removal; interactive managed shell input and process join; JSONL provider/tracker exports for Maintenance composition. Upstream removed invariant and generated scoped-events patches are retired.

Use the independent runtime and the 13-package overlay together. Never overwrite an active Launcher installation. The CPA fixed-account patch remains a separate local CPA component and is not a DSH source patch.

See `../docs/dsh021-release.md` and the iteration acceptance report for build and deployment evidence.
