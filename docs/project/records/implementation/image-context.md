---
id: IMP-image-context
kind: implementation
title: 引用预算与 GPT 图片传输和压缩
status: current
summary: Core 缺失计价时采用中性预留；GPT 在发送边界读取附件，成功压缩后由检查点接续旧图。
relations:
- relation: implements
  to:
    record_id: REQ-image-context
  reason: 保留原始图片并补齐引用与压缩链路
---

Core：src/host/submission-budget.ts 区分没有计价能力和无效计价，前者按每图 4096 预留，后者保留拒绝。

GPT：src/responses-images.ts 管理持久引用、预算及发送前读取；responses-wire.ts 转换用户和工具图片；responses.ts 将该路径接入普通生成、计数和压缩；native-budget.ts 在完整成功检查点之后替换已覆盖图片；context.ts 为通用摘要增加图片预算及视觉信息保留要求。

版本：dsh-annotation-core 0.3.12-rc2.13、dsh-gpt-compat 0.5.0-dev.4。无会话历史迁移，不删除附件。估算不代表精确 token。部署与验证结果见 VER-image-context。
