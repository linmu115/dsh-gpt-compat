---
id: VER-image-context
kind: verification
title: 图片引用、发送与压缩接续验证
status: current
summary: 两插件类型检查及离线回归通过，真实 GPT 合成图在压缩后仍识别背景色与数字；用户会话发送待验证。
relations:
- relation: verifies
  to:
    record_id: IMP-image-context
  reason: 校验图片不丢失、预算以及压缩后的接续
---

2026-09-17：Core 全套 241 项中 239 项首次通过，另 2 项仅为包版本断言，随版本升级后定向 6 项全通过；预算与引用提交 29 项通过。GPT 全套 69 项通过、1 项可选 live 测试跳过；两个插件类型检查与构建通过。

新增测试覆盖：缺失计价接口的历史图片、用户与工具图片顺序、按请求去重读取、持久引用往返、图片视觉预算与 base64 分离、缺失存储、无效引用、超限与取消、两种压缩协议和序列化恢复接续。

额外真实 CPA 合成图验证（不是可选 live 单测）：gpt-5.6-luna 识别红底白色数字 47；仅将用户图文交给 compaction，没有把首次回答交给摘要；成功后不再携带旧图片、仅用检查点回答 Red 47。本地预算估算 6243 降到 284。报告保存在维护工作区 diagnostics/sidebar-upstream-20260917/gpt-images-live-report.json，不保存密钥或加密检查点。

这是合成小样本，不证明所有视觉细节无损、接近模型窗口上限时的性能或用户会话已成功发送。安装文件更新后，正在运行的 DSH 服务需要重新加载才能使用新后端代码。
