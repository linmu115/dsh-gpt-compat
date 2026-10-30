> RC3 Windows/macOS candidate: [0.6.0-dsh021rc3.1](docs/RELEASE-RC3.md).

> Current local release: **0.6.0-dsh021.1**, Accounts **0.1.4-dsh021.1**, exact DSH **0.2.1-rc.2** with **gpt-dsh021.1**. See [current release](docs/dsh021-release.md). Older RC2 sections below retain their historical scope.

# DSH GPT compatibility

当前升级候选为 **0.6.0-dsh02.1**，可选账号模块保持 **0.1.4-dsh02.3**。目标是 DSH **0.2.0-rc.2** 与 Cordis **4.0.4**，并且必须使用配套的独立宿主扩展 **gpt-dsh02.1**。未修改的官方 Launcher 宿主不能只安装这个插件就使用完整功能。增量交付、额外压缩用量/只读诊断及显式服务端压缩见 [2026-10-03 升级记录](docs/upgrade-20261003.md)；此前进程/凭据维护与安装历史保留在 [维护记录](docs/maintenance-20261003.md)。

插件提供按会话模型范围启停的 `apply_patch`、`exec_command`、`write_stdin`，可选 Responses 传输，以及原生/可读摘要双检查点上下文管理。工具通过当前 agent 的文件系统、shell、权限及受管进程服务执行，不启动嵌套 Codex CLI。上下文管理默认关闭，原始会话保留，选定的请求内容在发送前持久化。

RC2 适配把工具结果改为 0.2 的 top-level tool 消息，保留调用配对、source、模型 replay 与 offloaded image 含义；设置页使用新的配置表单服务，受管命令使用异步 shell 就绪及取消契约。两个 npm 包保持 private。2026-09-30 的主插件 `.1` 与账号模块 `.2` 已在准确 Launcher RC2 实例安装并验证真实模型及工具链；这不代替新候选的安装和验收。

## 构建和产物

完整可复现步骤见 [0.2 候选发行说明](docs/dsh02-release.md)。[当前宿主补丁](host-patches/dsh-0.2.0-rc.2-gpt-dsh02.1.patch) 基于官方 `639ed015`，相邻 manifest 列出源文件摘要并记录 `git apply --check` 通过。

宿主构建使用 TypeScript 完整类型化 emit，再生成运行包，包含 const enum 内联与相对扩展名改写。独立运行树复制实际宿主包、覆盖 13 个扩展包，避免 pnpm 原路径回落到旧 Session。扩展包版本为 `0.2.0-rc.2+gpt-dsh02.1` 并携带明确的 `dshManagedPatch` 标识。

```text
node scripts/prepare-host-patch.mjs
node scripts/build-host-candidate.mjs
node scripts/audit-host-candidate.mjs
node scripts/build.mjs
node scripts/package-candidate.mjs
```

先按发行说明设置源码基线、独立候选源码和实际宿主依赖路径。这些脚本不写入 Launcher 安装目录，不启动或停止实例。生成的运行树仍使用列明的第三方本地缓存链接，不是可脱离本机缓存的安装器。

## 使用边界

- Responses 的原生重放限定于相同提供商、模型、端点与凭据范围；不支持的协议控制项明确拒绝。图片、上下文预算与 CPA 模式详见 [Responses](docs/responses.md) 和 [上下文](docs/context.md)。
- 多文件补丁不是事务，部分失败会报告已完成的修改；进程句柄不跨重启恢复。取消和卸载等待受管进程收尾。
- 可选 [CPA 账号模块](docs/accounts.md) 仍要求其对应服务能力，不会自动安装 CPA 固定账号补丁或切换账号。
- GPT 扩展日志使用独立能力的 V4 方言。官方 stock V4 必须继续拒绝五类 GPT 非命名空间事件，Maintenance 不应把它们当作普通 V4 静默接受。见 [Maintenance 边界](docs/maintenance.md)。

源码最终回归为 91 通过、1 个 live-model 测试跳过；真实类型、构建、模块加载与独立 V4 编解码审计通过。0.2 的真实 UI、旧配置恢复及 live-provider 验收单独记录，不能引用旧版本的真实调用作为本次通过证据。旧 0.1.5 文档与补丁仅作历史保存，旧补丁不进入当前发布包。历史 CPA 记录见 [qualification](docs/qualification.md)。
