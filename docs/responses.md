# 原生 Responses 接入

`dsh-gpt-compat/responses` 是独立可卸载的提供商插件。工具插件负责按模型绑定启停；提供商插件负责线协议、凭据和原生重放。已有模型服务不被静默替换。

## 配置

在 DSH profile 中保留工具插件，再增加下面的入口。示例 ID、端点和容量必须换成实际配置；本机已验证此 CPA 地址。以下显式模型配置用于未接入自动发现的普通 Responses 路线；已连接 CPA 账号模块且使用 codex-v2 时，模型列表由 CPA 自动发现结果替代。

```yaml
- id: gpt-responses
  name: dsh-gpt-compat/responses
  config:
    providers:
      cpa-native:
        baseURL: http://127.0.0.1:8317/v1
        apiKeyEnv: CPA_API_KEY
        nativeContextMode: codex-v2
        tokenEstimateMultiplier: 1.5
        models:
          - id: gpt-model-id
            contextWindow: 262144
            maxTokens: 32768
            reasoningEfforts: [low, medium, high]
            defaultReasoningEffort: medium
```

本插件注册的 `cpa-native` 路线自动启用 GPT 兼容，无需在设置页填写绑定。容量数字只是格式示例，代码没有按模型家族写死上限。凭据从 DSH credentials 服务读取；没有该服务时使用启动环境。配置和日志不保存原始 key。

连接配置注册在 `gpt-responses` 设置空间，并进入提供商配置目录。端点、凭据引用与容量按请求准备时的快照固定，下一次请求采用新设置。重复 provider ID 会报错；原生入口与 pi-ai 不能同时占用相同 ID。

`reasoningEfforts` 声明该模型可选的推理强度，`defaultReasoningEffort` 必须属于该列表。DSH 使用这份声明显示选择器，并把选中的 ID 作为 `reasoning.effort` 发送。应按实际模型与路由配置，不按 GPT 名称推断档位；没有声明时保持原有无选择器行为。更新影响下一次请求，已经准备的请求继续使用原快照。

## 往返与重放

编辑工具使用 Responses `custom` 声明和纯文本 `input`；适配器转换为内部 `patch` 参数，文件操作仍经过 DSH 工具执行器。命令和其他工具使用 function 工具。历史调用只序列化，绝不重新执行。

完整输出项、response ID 和内容校验值保存在 DSH 原有 `ReplayEnvelope.response`，不改变 Session 格式。它只在内容一致且提供商、模型、端点、凭据及原生模式范围相同时复用。其他模型仍可读取可见文本和工具结果，加密状态不进入它们的请求。未压缩日志经 JSON 存盘、Session 重建后仍可恢复该元数据。

HTTP 带 DSH attribution，禁止自动重定向；请求、响应均有字节上限，并支持整体超时和取消。终态缺失、重复工具 ID、未知 custom tool、未完成工具输入或超限输出不能成为可执行调用。截断响应只报告 `max-tokens`，不执行部分补丁。错误正文不回显，结构化代码区分上下文超限、余额不足和限速。

当前 SSE 缓冲到完整终态后发布，逐 token 展示待接入。文本/工具之外的输入明确拒绝，或由 DSH 执行自身已有的附件投影；没有原生图片或音频支持。`stop` 明确拒绝。

## 压缩边界

`nativeContextMode` 默认 `responses`：调用独立 `/responses/compact`，保留其完整返回窗口，自动预算要求 `/responses/input_tokens`。显式选择 `codex-v2` 后，压缩通过普通 Responses + `compaction_trigger` 发起，预算采用本地估计；保留用户原文并追加新的加密检查点。取消、截断、空检查点或夹带工具的结果不被提交。两种模式不会自动回退。直接 `ResponsesAdapter.compact(...)` 返回窗口与 usage；控制器调用负责持久化与选择。

独立调用仍只提供传输能力。`0.5.0-dev.1` 的可选上下文管理把预算、工具配对、双检查点持久化和模型切换接续接到宿主请求组装入口；见 [上下文配置](context.md)。它由客户端触发压缩，默认关闭；这与服务端 context_management 自动压缩不同。完整真实验证及估计边界见 [联调说明](qualification.md)。

协议依据：[OpenAI 自定义工具](https://developers.openai.com/api/docs/guides/function-calling)、[独立压缩接口](https://developers.openai.com/api/docs/guides/compaction)。当前 CPA 的实际支持范围与限制见 [联调记录](qualification.md)。

## 验证

离线测试启动本机 HTTP 服务，经真实 Cordis Loader、DSH agent loop 和工具执行器创建临时文件，再检查下一轮 HTTP body。另覆盖日志序列化还原、跨提供商切换、设置快照、取消、错误分类和完整压缩窗口。

`tests/responses-live.spec.ts` 默认跳过。只有显式设置 `GPT_COMPAT_LIVE_TEST=1` 并提供 `GPT_COMPAT_LIVE_URL`、`GPT_COMPAT_LIVE_MODEL`、`GPT_COMPAT_LIVE_CONTEXT`、`GPT_COMPAT_LIVE_KEY` 才发送真实请求。它仅检查普通 Responses 文本响应及重放元数据，不能替代 custom tool 和 compact 的真实验收。

## CPA 自动模型发现

同一端点的 CPA 账号模块已连接且使用 `codex-v2` 时，账号的 `/auth-files/models` 与 `/model-definitions/codex` 取交集，提供全部 GPT 会话模型。固定模式只读取选定账号，普通模式读取已启用账号，暂停模式提供空列表。图片生成模型不进入文字会话选择器。容量及推理档位来自 CPA 定义；发现失败或缺失容量会报错，不用旧列表冒充成功，也不猜测上下文容量。未接入管理模块或其它端点继续使用显式配置。

准备请求时复制提供商配置与解析后的模型能力，保留步骤快照。账号管理操作通知宿主刷新模型目录；设置列表刷新发现变化时也通知会话选择器。这里检测的是 CPA 宣告可用的模型，不等同于逐个模型完成真实生成验收。


## 图片上下文（0.5.0-dev.4）

用户消息与工具返回的图片以 DSH 持久附件引用进入原生投影；只在 HTTP 发送边界通过附件服务校验并读取字节，转换成 Responses input_image。普通发送、远端计数、独立 compact 与 codex-v2 共用这条转换路径。读取失败、取消或请求字节超限会中止，不静默过滤图片。

Core 0.3.12-rc2.13 在适配器缺少 imageRequestPricing 时按每次出现预留 4096 token；适配器已返回错误结果仍拒绝。GPT 适配器公开估算接口：每图至少 4096，较大图片按 32 像素格估算并留余量；v2 总预算再乘配置的估算乘数。估算不是计费值或严格上界，不按 base64 长度计作文字 token。通用摘要预算同样计入图片。

v2 压缩请求包含被覆盖的图片。只有成功获得完整加密检查点后，保留窗口中的旧图片才转成“已包含在压缩上下文”的文字标记，用户文字原样保留。原始会话附件不删除；近期保留组的图片仍原样发送。独立 compact 的完整返回窗口不丢弃，已知回传图片恢复成持久引用。通用摘要明确要求保留与任务有关的图片内容和文字标签。

依据：[Responses 请求约定](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)。真实 CPA 合成图通过发送、压缩和恢复接续，尚未用用户会话做发送验证；图片摘要仍有信息损失，不能宣称所有视觉细节无损。
