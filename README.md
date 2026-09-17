# DSH GPT 兼容插件

开发版本实现按提供商和模型自动启停的编辑、命令工具链，并提供可选原生 Responses 入口。它直接使用每个 DSH agent 的文件系统、shell、工具执行与会话服务，不启动嵌套 Codex CLI。

当前版本 `0.5.0-dev.3`，公开源码仓库 [linmu115/dsh-gpt-compat](https://github.com/linmu115/dsh-gpt-compat)。需要基于 DSH `3a7508d20` 的 [宿主补丁](host-patches/rc2-gpt-compat.patch)，普通 RC2 不能只装插件就使用。已在用户授权的 0.1.5-rc.2 副本接入并完成真实工具调用；主实例未切换。

## 已实现

- 模型设置页底部的“GPT 兼容工具”绑定编辑器；按提供商稳定 ID 和明确模型名或末尾 `*` 前缀匹配，默认不绑定。
- 在下一步骤开始前捕获选择。会话隔离，预览不改变正在使用的工具；绑定关闭后恢复原工具。
- `apply_patch`：新增、更新、移动、删除；支持多片段、CRLF、中文。预先检查整个补丁，写入和删除带文件版本检查。多文件不是事务：中途失败报告已修改文件。
- `exec_command` 与 `write_stdin`：使用配置的 DSH shell，继承受管 DSH 会话环境，传递 stdin、逐次读取输出、报告退出状态、取消和限制输出；句柄仅属于一个 agent。
- 切换或热卸载停止拥有的命令并等待受管进程范围退出，保留停止通知。注册效果可撤销，其他 DSH 工具和底层服务继续工作。

补丁语法使用 `*** Begin Patch`、`*** Add/Update/Delete File`、可选 `*** Move to`、`@@` 和 `*** End Patch`。匹配必须精确且唯一。当前不声称与某个 Codex 上游版本逐字节等价。

宿主变更另附 [可审阅补丁](host-patches/rc2-gpt-compat.patch)，已对基线工作树执行 `git apply --check`，已用于独立副本运行时，未覆盖主实例。

## 当前边界

这不是完整 Codex harness 复刻。`dsh-gpt-compat/responses` 将兼容 `apply_patch` 声明为原生 custom tool，模型直接返回补丁文本，适配器转换为 DSH 内部 `{ "patch": "…" }` 执行。普通适配器仍使用 JSON 参数。原生入口保存响应 ID、完整输出项及加密推理元数据，只有相同提供商、模型、端点及凭据范围才复用。

`0.5.0-dev.1` 已实现可选的自动压缩、双检查点持久化与跨模型选择，默认关闭。GPT 使用原生检查点，其他模型在原文装不下时才生成可读摘要；两条路径各自追加新历史。原始会话保留，压缩结果和请求选择在发送前持久化。本地 Loader 测试覆盖压缩后的往返、日志恢复、失败和取消；真实 CPA 的 v2 工具、自动原生压缩及检查点跨进程恢复已通过；详见 [联调记录](docs/qualification.md)。配置、协议选择与预算限制见 [上下文说明](docs/context.md)。

原生入口当前支持文本与工具，接收 SSE 后等待完整终态才发布内容，尚未逐 token 显示；不支持的 `stop` 控制项明确拒绝。真实 CPA 已验证工具执行和跨进程会话重放；当前 CPA 使用显式 codex-v2 模式和本地预算估计；旧 compact 路由及原生计数仍不可用。副本安装与真实调用已验收；运行中命令的进程句柄不跨重启恢复。

命令运行在所配置的 DSH shell；不接受每次调用更换 shell、登录方式或 PTY。Ctrl-C 字符触发取消，Ctrl-D 关闭输入管道。进程句柄不会在重启后恢复。权限和沙箱继续由 DSH 执行链及当前 agent 的服务决定；未提供新的提权入口。

宿主扩展提供提示词组装前的路由解析与准备、受版本保护的单文件删除、shell 输入管道及受管进程范围收尾。旧宿主缺少准备接口时插件加载失败，不静默降级。

## 配置与构建

`cordis.patch.yml` 是 bundle 插入配置，默认 `bindings: []`。已验证通过真实 `cordis.yml` Loader 加载源代码组成的测试配置；打包产物已在测试专用宿主组合中通过模拟服务及真实 CPA 账号检查；副本产品接入已通过，范围见 [验收记录](docs/qualification.md)。

模型页面保存到 `gpt-compat` 设置空间。每条绑定具有 `provider` 与 `models`；例如提供商 ID `cpa`、模型范围 `gpt-*`。保存保留草稿读取时的版本，冲突时保留草稿。移除全部绑定即关闭工具兼容。

默认隐藏工具为 `write`、`edit`、`str_replace_editor`、`bash`、`pwsh`。自定义工具部署需要核对 `hiddenTools`。其余可配置项为补丁、文件、输出大小，进程数量，以及默认与最大等待时间，见 `src/config.ts`。

在当前已配置的开发依赖中，以下命令已执行：

```text
$env:DSH_HOST_ROOT = "D:\dev\deepseek-harness"
node scripts/configure-types.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node scripts/build.mjs
```

先准备上述基线的宿主源码、应用补丁并按宿主开发说明构建类型；设置 `DSH_HOST_ROOT`（默认查找相邻 `../deepseek-harness`），安装本包开发依赖，再运行上面命令。生成的本机类型配置不提交。测试复用宿主的 decorator 转换与合成测试助手。构建产生 `lib/index.mjs`、`lib/responses.mjs`、`lib/client.js`。当前通过已配置依赖验证，尚未做全新机器安装验收。

原生入口通过独立 `cordis.yml` 条目挂载，见 [Responses 接入说明](docs/responses.md)。已有提供商 ID 被其他适配器占用时拒绝重复注册；需要在配置中把该路由交给原生入口，或使用独立 ID 并在兼容绑定中选择它。默认 bundle 不自动改动已有提供商。

## 验证与后续

测试包含真实 Loader、真实临时文件、真实 PowerShell，以及可控模型响应的 agent loop；普通测试不调用真实模型；本阶段另有显式授权的 CPA 账号联调。模型设置组件测试覆盖绑定保存、版本传递、拒绝后保留草稿及清空绑定。完整记录和后续协议/压缩缺口见 [项目地图](docs/project/map.md) 与 [当前实现](docs/project/records/implementation/current.md)。没有性能、智力、时间或成本改善的实测结论。

## Session Maintenance 接入

插件扩展会话事件，因此必须使用独立 `dsh-gpt-compat` Harness Adapter，见 [接入合同](docs/maintenance.md)。它由 Session Maintenance 仓库提供；不要全局替换普通 Adapter 的读取依赖。当前副本的早期联调曾采用重新打包方案，新独立 Adapter 已完成源码与合成测试，其运行部署仍需正式升级与重新绑定。
