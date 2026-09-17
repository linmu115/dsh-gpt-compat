# 两版压缩与跨模型接续

`0.5.0-dev.1` 提供独立的原生检查点与可读摘要。两者共享保留的原始会话，按当前模型的容量分别触发，不要求同时生成。

## 开启

需要本包附带的宿主补丁、可写的会话持久化服务，以及已配置的原生 Responses 入口。自动上下文管理默认关闭。在兼容插件配置或 `gpt-compat` 设置空间增加：

```yaml
context:
  enabled: true
  triggerRatio: 0.8
  reserveTokens: 4096
  marginTokens: 1024
  retainGroups: 2
  maxPasses: 64
  summaryMaxTokens: 2048
  summaryProvider: ''
  summaryModel: ''
```

模型设置页仍只编辑提供商/型号绑定；上述高级字段通过配置或设置服务修改。`context.enabled: false` 在下一步骤撤销上下文管理。移除工具绑定会切回普通工具，但已产生检查点的会话仍由通用上下文策略接续；需要停用整个上下文功能时关闭该开关或卸载插件。

原生路线仍由 `bindings` 决定。模型容量读取准备好的提供商声明，未写死 256k 或 1m。输出预留优先使用本次请求的 `maxTokens`，未设置时才使用 `reserveTokens`。`retainGroups` 保留最近若干完整消息组；一次工具调用及其全部结果不被拆分，单个交互无法放入窗口时明确失败。

## 选择与保存

- 绑定 GPT 路线：复用适用检查点的完整原生窗口，追加尚未覆盖的原始消息。超过触发预算时，按完整交互分批调用配置的原生压缩协议。每批请求按所选计量方式检查预算。
- 其他路线：原文装得下就直接发送，既不调用摘要模型，也不强制复用旧摘要。装不下时才创建或增量扩展通用摘要。默认使用当前路线生成摘要，也可同时填写 `summaryProvider` 与 `summaryModel` 指定另一条已注册路线。
- 两种检查点各有覆盖位置和原文校验值。原生范围还绑定模型、提供商、端点、凭据与原生模式；不兼容时从保留原文重建。原生前缀不会发送给不匹配的适配器；GPT 路线不会看到通用摘要。
- 压缩操作输入先记录并持久化，再调用服务。成功结果与完整候选检查点写入日志，持久化成功后才写提交标记；循环把提交与最终请求选择持久化后才发送。未提交候选不会恢复为可用检查点。发送阶段的失败不撤销已经完成的压缩。
- 日志通过 `context/operation`、`context/operation-result`、`context/checkpoint`、`context/checkpoint-commit` 与 `request/projection` 重建。它们是宿主新增必读事件；旧宿主无法据此安全降级恢复。未改变原始 surface，不删除旧消息。
- 插件卸载取消它管理的进行中请求，撤销上下文所有权；下一步恢复普通历史读取与 DSH 基础自动压缩。日志中的摘要和原生检查点仍保留。打包产物在测试专用宿主组合中已覆盖两个独立进程间的模拟原生检查点恢复；真实 CPA 也已验证 v2 检查点的跨进程恢复，完整产品恢复流程尚待验收。

## 计量与限制

原生提供商默认 nativeContextMode=responses，需要 `/responses/input_tokens` 对完整输入计数。CPA 可显式选择 nativeContextMode=codex-v2，使用新版 compaction_trigger 协议与本地预算估计，不调用计数端点。v2 估计包含文本、工具和原生加密状态，默认乘数 tokenEstimateMultiplier=1.5，并继续扣除输出预留与 margin；不是精确计数，仍可能超窗。协议或预算失败保留原始历史及已提交检查点。

v2 检查点保留用户原文；本版不会为了挤入预算截断这些原文。原文过多或单个完整交互无法放入窗口时明确失败，不保证所有从大窗口回切的小窗口任务都能继续。普通生成 usage 与预算估计分开；辅助压缩的用量尚未接入统一统计。

通用路线按 UTF-8 序列化字节做保守文本估计，不是模型 tokenizer 的精确结果，可能提早摘要。原生适配器仍仅支持文本与工具。通用路线的图片、音频等非文本预算尚无可信计量，不纳入本版验收。摘要调用使用已配置的 LLM，“通用/本地保存”不等于本机离线推理。

完整窗口每轮写入请求投影，会增加日志体积；原生计数及分批压缩会增加 HTTP 请求和等待。没有性能、任务成功率或成本改善的实测结论。真实 CPA 的 v2 工具、压缩和检查点恢复已经通过；旧 compact 路由及原生计数仍不可用。完整产品安装与 UI 验收仍待完成。详见 [联调记录](qualification.md)。

协议参考：[OpenAI 压缩](https://developers.openai.com/api/docs/guides/compaction)、[原生输入计数](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens)。


## 图片上下文（0.5.0-dev.4）

用户消息与工具返回的图片以 DSH 持久附件引用进入原生投影；只在 HTTP 发送边界通过附件服务校验并读取字节，转换成 Responses input_image。普通发送、远端计数、独立 compact 与 codex-v2 共用这条转换路径。读取失败、取消或请求字节超限会中止，不静默过滤图片。

Core 0.3.12-rc2.13 在适配器缺少 imageRequestPricing 时按每次出现预留 4096 token；适配器已返回错误结果仍拒绝。GPT 适配器公开估算接口：每图至少 4096，较大图片按 32 像素格估算并留余量；v2 总预算再乘配置的估算乘数。估算不是计费值或严格上界，不按 base64 长度计作文字 token。通用摘要预算同样计入图片。

v2 压缩请求包含被覆盖的图片。只有成功获得完整加密检查点后，保留窗口中的旧图片才转成“已包含在压缩上下文”的文字标记，用户文字原样保留。原始会话附件不删除；近期保留组的图片仍原样发送。独立 compact 的完整返回窗口不丢弃，已知回传图片恢复成持久引用。通用摘要明确要求保留与任务有关的图片内容和文字标签。

依据：[Responses 请求约定](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)。真实 CPA 合成图通过发送、压缩和恢复接续，尚未用用户会话做发送验证；图片摘要仍有信息损失，不能宣称所有视觉细节无损。
