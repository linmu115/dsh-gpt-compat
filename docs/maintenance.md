# Session Maintenance 扩展数据接入

## 0.2.0-rc.2 当前边界

本轮 `gpt-dsh02.1` 独立宿主以 V4 物理格式持久化五类 GPT 事件。其 patched Session known-event catalog 与标准 catalog 组合后才接受这些事件；未修改的官方 stock V4 正确拒绝。Maintenance 必须使用独立、明确声明 GPT 能力的 V4 dialect/receipt，不能通过放宽 stock reader 取得兼容。当前宿主能力与本地 codec 审计见 [候选发行说明](dsh02-release.md)。下述 dsh-0.1.5/v3 身份与 Adapter 是历史记录，不能用于本候选。

## 0.1.5 历史接入

GPT 插件的 checkpoint、operation、result 和 request/projection 都属于插件扩展数据。按 Maintenance 的 [扩展数据合同](https://github.com/linmu115/dsh-session-maintenance/blob/codex/rc2-session-context-graph/docs/project/records/modules/adapters/business/contract.md)，先构建独立 ExtensionDataAdapter，再接入宿主。

实现包 `@linmu/dsh-session-extension-gpt-compat` 位于 Maintenance，namespace/面板 ID 为 `gpt-compat`。Harness 始终是 `dsh-0.1.5`，framing 是 `dsh-0.1.5-v3-jsonl-zstd-v1`。插件事件由自己的解析器校验，与宿主 codec 受信组合；原始 JSON、加密载荷和引用完整保留。扩展数据面板仅提供来源版本和数量摘要，不复制密文。

Launcher 验证插件版本、能力和文件哈希后报告原生扩展连接，Core receipt 使用原宿主身份加 `sessionFormat.extensions: ["gpt-compat"]`。模型切换只改变请求路由；不改变 Harness 身份。

此前误建独立 GPT Harness 的方案已撤销。历史事件身份和运行审计保留，经 Canonical 正常物化到宿主空间；旧运行先正常收尾再升级。经过的误解与纠正在 Maintenance 地图的 `HIST-gpt-extension-boundary`，当前配套源码为 Engine rc2.30 / 插件 rc2.24，部署结果由 Maintenance 本轮报告维护。
