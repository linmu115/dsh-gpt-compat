# 2026-10-03 RC2 maintenance

Candidate versions: GPT Compat `0.5.0-dsh02.2`, Accounts `0.1.4-dsh02.3`. The independent host remains `0.2.0-rc.2+gpt-dsh02.1`; no host format migration is intended.

## Scope

- Preserve command ownership until backend exit is confirmed. A failed or unavailable exit observation must not produce a stopped notice or silently release the command during route changes, cancellation, late preparation or unload.
- Validate a proposed CPA management credential against both account enumeration and the fixed-routing contract before replacing the saved credential. A rejected candidate must leave the old credential intact.
- Add a distinct opt-in real-provider qualification path for the RC2 artifacts and native persistence. Keep the existing synthetic qualification explicitly synthetic.

Implementation and regression review are complete: the RC2 suite passed 132 tests with one existing opt-in live test skipped, and type checking passed. Loader fixtures now resolve the actual host's Cordis and tools modules consistently; the previous duplicate tool-scheduler Symbol was a test setup defect. Ordinary command collection keeps its yield budget even if the parent has exited but its owned process scope is still closing. Explicit cancellation and close retain ownership until exit is confirmed.

The packaged candidate is built after these checks. Installation and separate real-provider qualification receipts are recorded in the workspace maintenance evidence directory; this source document alone is not proof of deployment or live acceptance. The host cohort is unchanged.

## Upgrade assessment

1. True incremental text/reasoning display: the current HTTP transport consumes SSE until the terminal response and only then yields assembled blocks. Existing stream events do not prove token-by-token UI delivery. This can be improved while retaining the rule that executable tool calls require complete validated inputs.
2. Compaction usage accounting: auxiliary compaction usage is not included in the host's unified totals. Expose it separately before presenting combined cost or token totals.
3. Explicit server-side compaction: the official Responses API offers `context_management` and streamed compaction items. Supporting it requires a new explicit mode with durable replay and checkpoint validation; it must not be enabled by relaxing unknown-output validation or silently replacing CPA `codex-v2`.
4. Read-only capability diagnostics can distinguish provider readiness, fixed-account support, counting/compaction mode and host extension availability. Probe behavior and credentials remain scoped to the configured endpoint.

Sources: [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction), and this repository's `src/responses-http.ts`, `src/responses.ts`, `src/context.ts`, `src/accounts/cpa.ts`.
