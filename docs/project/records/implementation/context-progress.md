---
{
  "id": "IMP-context-progress",
  "kind": "implementation",
  "title": "长历史发送预览与压缩进度",
  "status": "current",
  "modules": [
    "GPT适配"
  ]
}
---

验收：先展示待发送输入；显示真实压缩段数与等待时间；失败保留原因和草稿；正式提交不重复消息；保持当前引用原文及并行迁移接口。

GPT 负责发送预览和压缩进度。src/progress.ts 提供按 Agent 隔离的内存状态，受 Connection 鉴权的 /api/gpt-compat.progress 只读取指定会话。src/context.ts 在真实压缩调用前发布段数，结束或异常发布对应状态；原有历史选择、原生/普通模型检查点及引用保护边界保持不变。客户端通过 conversation.input.dock 在会话底部、输入框上方显示暂存输入和状态；成功后移除预览，失败仍保留原因与草稿。指示器使用实际段数和已等待时间，无虚构百分比，支持减少动画。版本 0.5.0-dev.7。

[开发历程与验证边界](../history/context-progress.md)。
