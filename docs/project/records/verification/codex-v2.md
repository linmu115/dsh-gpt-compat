---
{
  "id": "VER-codex-v2",
  "kind": "verification",
  "title": "Codex v2 原生压缩与真实恢复验证",
  "status": "current",
  "summary": "0.5.0-dev.1：46 项离线测试通过；真实产物执行两次原生压缩，跨进程恢复检查点，旧工具不重放。",
  "relations": [
    {
      "relation": "verifies",
      "to": {
        "record_id": "IMP-current"
      },
      "reason": "当前 CPA 新协议、预算估计及产物进程恢复"
    }
  ]
}
---

# Codex v2 原生压缩与真实恢复验证

2026-09-17，开发版本 0.5.0-dev.1。实现和复验方式见 `docs/qualification.md` 与 `docs/responses.md`。

- CPA 运行二进制内嵌提交为 ba200aef，与本地源码一致；对照 Codex 787823cf 的 compaction_trigger 流程，真实 CPA 返回加密 compaction。
- 直接检查点续轮不附旧原文，模型仍准确回忆标记和文件名：`artifacts/cpa-v2-probe.json`。
- 实际 tgz + Cordis Loader + DSH agent loop 通过工具、两次原生压缩及两个独立进程间的检查点恢复。恢复后的请求包含此前检查点，模型接续回答；补丁文件不重复写入、历史工具不重放：`artifacts/staged-runtime-phase5a/live-qualification.json`。
- 46 项离线测试通过、1 项独立 live 单测跳过。新增协议、快照、预算、作用域、重复压缩及无效结果拒绝测试：`artifacts/tests-phase5.json`。另有显式真实账号测试，跳过的单测不计通过。
- 类型检查、构建、离线打包通过，原有模拟服务产物恢复检查通过。最终重打包的运行文件一致性：`artifacts/package-phase5-check.json`。

v2 不调用 input_tokens，也不修改 CPA 旧路由；本地预算参考 Codex 启发式，并加可配置乘数。它不是精确计数；用户原文过多会明确失败，不截断原文。真实测试刻意用 8,000/128 和 0.1 触发配置，只验证流程，不证明最大窗口负载与估计精度。

测试宿主仍为 31 个构建包和 6 个缓存依赖的组合，不包含完整产品 profile、Typert/Remote/UI 或全新安装。辅助压缩用量尚未汇入统一统计，没有成本或开发表现改善结论。CPA 和日常 DSH 未被修改或部署。
