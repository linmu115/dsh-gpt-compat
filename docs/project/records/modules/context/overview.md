---
{
  "id": "MOD-context",
  "kind": "module",
  "title": "两版压缩与模型切换接续",
  "status": "current",
  "summary": "独立双检查点、按容量触发、分批补齐和持久化投影已实现；显式 codex-v2 模式已通过真实 CPA 压缩及检查点恢复。",
  "progress": "in_progress",
  "relations": [
    {
      "relation": "implements",
      "to": {
        "record_id": "REQ-gpt-compatibility"
      },
      "reason": "承接用户最终确认的双路径压缩"
    },
    {
      "relation": "provides",
      "to": {
        "record_id": "IF-context"
      },
      "reason": "提供选择与构造后的上下文"
    }
  ],
  "sources": [
    {
      "path": "../../src/context.ts",
      "role": "implementation"
    },
    {
      "path": "../../docs/context.md",
      "role": "specification"
    }
  ]
}
---

# 两版压缩与模型切换接续

该模块提供两条逻辑独立的上下文路径。原生路径保存 OpenAI 返回的完整压缩窗口；通用路径保留原始历史，必要时生成可读摘要。用户已经确认两者不必同时压缩。

每条路径按目标模型的有效容量计量，包含提示词、工具、待发消息与输出预留。256k / 1m 是用户当前配置场景，不是写死的模型家族上限。通用路径装得下原文时不额外调用摘要模型。

切换时选择本路径有效检查点，并接上其覆盖位置之后的全部新历史。大窗口模型下新增内容过多时，切回 GPT 需要按完整工具交互边界分批接入、逐步原生压缩；每一步都在可用预算内，成本和等待要计量。

只有完整生成并持久化的检查点才能替换活动状态。某侧失败保留该侧旧检查点、另一侧状态和原始历史；失败不能触发跨路线静默混用。停用插件后通用历史读取仍可用。

宿主通过 effect 所有权与 request/projection 交付选择后的请求，原始 surface 保留。日志记录完整候选与提交引用，并在发送前执行持久化屏障。接口见 [[IF-context|上下文交付合同]]。

实现位于 src/context.ts，默认 context.enabled=false。responses 模式调用 /responses/input_tokens；codex-v2 模式采用带裕量的本地估计及 compaction_trigger，已通过当前 CPA 验证。v2 保留用户原文，不适用时失败并保留历史，不宣称精确计数。存盘恢复、跨模型切换、取消与失败证据见 [[VER-context|双检查点验证]]。
