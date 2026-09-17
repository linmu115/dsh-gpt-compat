---
{
  "id": "IMP-current",
  "kind": "implementation",
  "title": "副本接入与独立 Maintenance Adapter",
  "status": "current",
  "summary": "0.5.0-dev.3 已完成副本真实调用，推理强度配置已补齐；Maintenance 独立适配器源码完成。",
  "progress": "in_progress",
  "sources": [
    {
      "path": "../../src/responses.ts"
    },
    {
      "path": "../qualification.md"
    },
    {
      "path": "../maintenance.md"
    }
  ]
}
---

# 副本接入与独立 Maintenance Adapter

开发包 0.5.0-dev.3。需要基于 3a7508d20 的宿主补丁；独立 0.1.5-rc.2 副本已安装，主实例未切换。此前真实 CPA 已验证原生压缩与跨进程接续；副本进一步完成 apply_patch、exec_command、write_stdin 真实调用，4 个模型步骤完成。证据汇总见 docs/qualification.md。

每个会话按提供商与模型绑定路由；原生 Responses 重放与双检查点持久化保留原始历史。nativeContextMode=codex-v2 使用 compaction_trigger 与标注的本地估计。推理强度从每个模型的 reasoningEfforts/defaultReasoningEffort 声明，不再因适配器未声明能力而失去选择。

0.5.0-dev.2 修复经典脚本 ModuleLoader 注册，dev.3 补齐模型推理配置。当前源码 51 项离线测试通过，1 项可选 live 测试跳过，类型检查通过；真实账号结果属于之前明确记录的验收。

Maintenance 之前用全局依赖替换重新打包以完成联调；现已构建独立 dsh-gpt-compat Adapter，按格式身份处理插件事件，见 [[INT-maintenance]]。独立 Adapter 的源码、合成恢复与路由验证已完成，运行副本尚未换成这次的新引擎。

尚待：独立 Adapter 正式部署、正常大容量长任务、压缩辅助调用用量汇总、全新机器安装和 Harbor / Inspect AI 对照评估。SSE 仍缓冲终态；进程句柄不跨重启恢复；不声称性能、智力、时间或成本收益。
