# Session Maintenance 会话格式接入

本插件写入 context/checkpoint、context/checkpoint-commit、context/operation、context/operation-result、request/projection，包含必需的重放和压缩语义。

按 Maintenance 的 [Harness Adapter 合同](https://github.com/linmu115/dsh-session-maintenance/blob/codex/rc2-session-context-graph/docs/project/records/modules/adapters/harness/contract.md)，先构建独立会话格式 Adapter，再接入实例。实现包 `@linmu/dsh-session-adapter-gpt-compat` 位于该仓库，Adapter ID `dsh-gpt-compat`，formatId `dsh-gpt-compat-v1-jsonl-zstd`，能力 `dsh-gpt-compat/session-v1`。普通 V3 Adapter 不承接这些新增必需事件。

启用该 bundle 的 profile 由 Maintenance 验证插件版本、能力、文件哈希后选中独立 Adapter。Core receipt 的 sessionFormat 与运行回执必须匹配；发布包应含独立 worker。模型切换只改变请求路由，不改变历史所属的会话格式。

早期副本联调用全局依赖替换重打包过 Maintenance，不能当作正式 Adapter 接入。新源码已拆分；运行升级须先正常停止目标、备份、生成实际构件回执并 repair，不能直接改运行中的格式身份。新格式会使用不同的 native-space 键，历史需通过 Canonical 正常物化。
