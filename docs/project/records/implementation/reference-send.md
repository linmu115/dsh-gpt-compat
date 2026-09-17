---
{
  "id": "IMP-reference-send",
  "kind": "implementation",
  "title": "GPT 当前输入和引用原文保留",
  "status": "current",
  "modules": [
    "GPT适配"
  ]
}
---

src/context.ts 的保留边界包含最近用户输入及其后的注入材料；tests/context.spec.ts 验证当前引用原文不进入压缩请求。

需求：先压缩旧历史，再原样注入本次引用与正文；不因单纯设置操作新增会话。

[开发过程、测试与部署边界](../history/reference-send.md)。

当前边界以请求中本次用户消息 ID 为准，避免把已完成旧轮次当作草稿保护。准备阶段还包含四类内部上下文事件；这些事件本身不触发派生。版本与真实验证状态见开发历程。
