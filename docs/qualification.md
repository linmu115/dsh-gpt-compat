# 打包产物与 CPA 联调

`0.5.0-dev.1` 已通过真实 CPA 的工具执行、原生压缩和跨进程检查点接续。验证使用测试专用 DSH 组合，尚未安装到日常环境。

## 协议差异与修复

CPA 位于 `D:/AI/CLIProxyAPI`，端点为 `http://127.0.0.1:8317/v1`。Go 二进制的内嵌构建信息确认提交为 `ba200aefa0c657a3390f278e74a21708b3589a5c`，构建时源码未修改，和本地 HEAD 一致。此前只有 `--help` 中的 dev/unknown 提示不足以识别版本，此次已补证。

原账号额度耗尽后，用户完成另一账号登录。普通 Responses、自定义工具和结果回传可用，旧 `/responses/compact` 的有效请求仍返回 404，`/responses/input_tokens` 没有路由。参考当前 Codex 实现发现，它已使用普通 Responses 末尾的 `compaction_trigger` 控制项进行远程压缩。当前 CPA 能原样接通该流程。这个结果解决了本项目的实际压缩接入，不代表旧 compact 路由的上游 404 已被修改或修复。

提供商配置新增 `nativeContextMode: codex-v2`，显式选择新版协议和本地预算估计。默认仍为 `responses`，保留独立 compact 和原生计数端点模式。模式参与检查点兼容身份，切换后从原文重建，不静默套用旧状态。未修改 CPA 源码、配置或运行二进制。

v2 只接受已完成且只包含一个有效原生 compaction 项的响应。它保留输入中用户及 developer 原文，再追加新检查点；已有旧检查点不重复保留。工具组由控制器保证完整，近期历史仍原样追加。不会拿普通文字摘要冒充原生检查点，也不执行压缩响应中的工具。

## 预算边界

v2 本地估计参考 Codex 的文本与加密状态计量启发式，包含指令、工具、历史和原生状态；默认估计乘数 1.5，可通过 `tokenEstimateMultiplier` 调整。它避免依赖当前 CPA 不存在的计数路由，但不提供 tokenizer 精确值或严格不超窗保证。估计不替代服务端计费用量。输出预留、触发比例与 margin 由既有配置另行控制。

本版不截断保留的用户原文。如果用户原文或一个完整工具交互过大，无法满足预算时明确失败，保留原始日志。CPA 会移除 `max_output_tokens`，输出预留不是上游强制输出上限。普通生成 usage 沿用宿主记录；辅助压缩调用的 usage 尚未汇入宿主统一用量统计，因此不能用该统计作完整成本结论。

## 验证结果

- 46 项离线插件测试通过，1 项可选 live 单测跳过；严格类型检查与构建通过。
- 新测试覆盖：v2 协议选择与请求快照、无计数网络调用、模式身份隔离、指令与工具预算、重复压缩保留用户原文，以及拒绝截断、空检查点和夹带工具的压缩输出。
- 直接 CPA 探测返回单个加密 compaction；只给检查点和新问题、不回传旧原文时，模型准确回忆先前标记和文件名。报告 `artifacts/cpa-v2-probe.json`。
- 实际 tgz 通过 Cordis Loader 装入测试专用宿主。真实 gpt-5.6-luna 在 agent loop 中执行一次补丁、自动压缩并保存检查点。第二个独立 Node 进程恢复会话，后续请求使用此前检查点，模型正确接续，旧工具未重新执行，文件时间戳不变。两次真实原生压缩成功。报告 `artifacts/staged-runtime-phase5a/live-qualification.json`。
- 实际产物仍通过原有模拟服务的跨进程检查点恢复检查。最终文档重打包后的运行文件与已验收包一致性另存 `artifacts/package-phase5-check.json`。

真实测试使用刻意缩小的 8,000 输入容量声明、128 输出预留和 0.1 触发比例，以少量合成消息触发流程。这是测试预算，不能当作模型实际能力或产品配置建议；没有进行接近真实最大窗口的压力测试。没有开发成功率、智力、时间或成本收益结论。

## 产物隔离范围

测试目录有独立 node_modules：插件来自 tgz，31 个宿主运行包由隔离工作树构建产物组装，6 个第三方依赖链接本机缓存。没有 TypeScript 源码别名。未包含生成的 Typert/Remote/UI 入口，详见 assembly.json。这不是完整产品 profile、全新联网安装或生产 UI 验收。

## 重复验证

`scripts/qualify-cpa.py --config D:/AI/CLIProxyAPI/config.yaml --model gpt-5.6-luna --context-mode codex-v2 --report artifacts/cpa-v2-report.json` 检查合成协议链。密钥仅在进程内读取，报告保存状态、输出类型与汇总用量，不保存密钥或加密内容。Python 需要 PyYAML。

`scripts/stage-runtime.mjs` 组装测试宿主；`scripts/qualify-artifact.mjs` 检查模拟服务；`scripts/qualify-artifact-live.mjs <stage>` 检查真实账号。后者需要 GPT_COMPAT_LIVE_TEST=1、GPT_COMPAT_LIVE_URL、GPT_COMPAT_LIVE_KEY、GPT_COMPAT_LIVE_MODEL，另设 GPT_COMPAT_LIVE_CONTEXT_MODE=codex-v2 才启用原生压缩验证。配置文件仅保存密钥环境变量名；隔离测试会话含正常原生重放数据。测试脚本不安装日常 DSH。

## 后续

完整产品 profile、设置 UI、正常容量下的长任务、压缩辅助用量统计及 Harbor / Inspect AI 对照仍待完成。默认不自动开启日常上下文管理。

协议参考：[Codex v2 压缩请求](https://github.com/openai/codex/blob/787823cf957709b314276646024ec54e1761c089/codex-rs/core/src/compact_remote_v2_attempt.rs)、[Codex 预算估计](https://github.com/openai/codex/blob/787823cf957709b314276646024ec54e1761c089/codex-rs/core/src/context_manager/history.rs)、[OpenAI 独立及服务端压缩](https://developers.openai.com/api/docs/guides/compaction)。新版 Codex 控制项与公开 Responses 独立压缩接口是分别配置、分别验证的路线。

## 0.5.0-dev.3 副本及发布验证

2026-09-17，用户授权的 0.1.5-rc.2 副本完成真实 CPA 调用：gpt-5.6-luna/high，apply_patch、exec_command、write_stdin，4 个模型步骤结束。真实临时文件得到预期标记。dev.2 修复 ModuleLoader 经典脚本加载；dev.3 为每个模型配置推理强度及默认值。真实请求和加密状态保留在本机 artifacts，不发布到 GitHub。

本次发布前使用 DSH_HOST_ROOT 配置的宿主完成 51 项离线测试，1 项 live 测试跳过，严格类型检查通过。这里没有重新消耗真实模型额度。Maintenance 先前的全局重打包方案已在源码层改为独立会话格式 Adapter；新引擎尚未替换运行副本，不能将旧真实调用当作新 Adapter 的部署验证。
