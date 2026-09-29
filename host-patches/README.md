# Host extension baselines

The current candidate is `dsh-0.2.0-rc.2-gpt-dsh02.1.patch`, generated against official DSH commit `639ed015` and verified with `git apply --check`. Its adjacent manifest records every original and resulting file hash. It is an independently maintained host extension, not a capability of the unmodified Launcher distribution.

The 13 rebuilt host packages identify themselves as `0.2.0-rc.2+gpt-dsh02.1` and carry `dshManagedPatch`. The build copies all actual host packages into an independent runtime so unmodified catalog and persistence packages resolve the patched Session package. The V4 writer/current restore accepts the five GPT extension events there; the unmodified official catalog must still reject them. A Maintenance reader requires the matching GPT dialect capability rather than treating this data as plain stock V4.

`legacy/dsh-0.1.5-rc.2-gpt-compat.patch` is a source-history archive, excluded from the current plugin tarball. Do not apply it to DSH 0.2. The separate CPA fixed-account patch targets CLIProxyAPI; it is not a DSH host patch and is not installed by these build scripts.
