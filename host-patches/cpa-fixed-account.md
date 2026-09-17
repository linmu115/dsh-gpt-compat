# CPA fixed-account integration patch

Apply `cpa-fixed-account.patch` to CLIProxyAPI commit
`ba200aefa0c657a3390f278e74a21708b3589a5c` (v7 source tree).
This is a separately maintained local extension, not an upstream capability.

```text
git apply --check /path/to/cpa-fixed-account.patch
git apply /path/to/cpa-fixed-account.patch
gofmt -w cmd/server/main.go internal/api/server_management.go internal/config/config_types.go sdk/api/handlers/handlers.go sdk/cliproxy/auth/conductor_execution.go internal/api/handlers/management/codex_account.go internal/api/handlers/management/codex_account_test.go sdk/cliproxy/auth/codex_account.go sdk/cliproxy/auth/codex_account_test.go
go build -o cli-proxy-api ./cmd/server
go test ./sdk/cliproxy/auth ./sdk/api/handlers
go test ./internal/api/handlers/management -run CodexAccount
```

The authoritative contract is `docs/codex-fixed-account.md` in the patched CPA
tree; that file is included in the patch. The DSH consumer's behavior and setup
are described in [accounts.md](../docs/accounts.md).

Never include CPA config, auth files, passwords, binary artifacts, or a user's
local startup script in this patch. Recheck and rebuild against future upstream
versions before upgrading the active server.
