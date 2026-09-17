---
{
  "id": "VER-tools",
  "kind": "verification",
  "title": "工具首版与宿主扩展验证",
  "status": "current",
  "summary": "13 项插件测试及 94 项宿主聚焦测试通过；真实文件、PowerShell、Loader，模型为测试替身；广域回归仍有环境及基线问题。",
  "relations": [
    {
      "relation": "verifies",
      "to": {
        "record_id": "IMP-current"
      },
      "reason": "覆盖本次已实现工具与绑定范围"
    }
  ]
}
---

# 工具首版与宿主扩展验证

2026-09-16，Windows 本机，宿主基线 `3a7508d20`。

- 插件 13 项测试：5 项解析/配置/输出边界，6 项真实 Loader/agent loop 集成，2 项模型设置组件交互。集成覆盖真实文件增删改移、坏补丁写入前拒绝、旧工具禁止执行、会话隔离、PowerShell stdin 与 DSH_SESSION_ID/DSH_SHELL 环境、模型切换、卸载与重新挂载，以及准入失败后保留停止通知。
- 宿主聚焦测试 94 项通过：system-prompt 全部相关测试、model-selection、单文件删除的版本/取消/目录保护，沙箱删除拒绝。
- 受影响宿主后端 TypeScript 构建通过；插件后端与界面类型检查及 bundle 构建通过。产物为 `lib/index.mjs`、`lib/client.js`，已离线打包为 `artifacts/dsh-gpt-compat-0.1.0-dev.1.tgz`。宿主补丁 `host-patches/rc2-gpt-compat.patch` 已在未修改基线工作树上通过 `git apply --check`；这仅检查可应用性，没有实际应用。
- 更广宿主回归首次运行 229 项：216 通过、12 失败、1 跳过。提示上下文身份断言已按新快照合同修正并重测通过。余下 9 项为本机符号链接 EPERM，2 项为 PowerShell 短时限取消失败；未据此宣称整个宿主回归通过。未修改版本的对照运行被其依赖路径解析错误挡住，因此短时限失败尚未完成基线归因。
- 前端宿主全链类型构建被该工作树缺失的生成 remote 声明和 React 包链接挡住；插件自身使用已生成声明的严格类型检查通过，不能替代完整宿主前端构建。
- 类型文档全局检查只报告未修改的 Session.appendInformational 文档缺项；导出 JSDoc 全局检查只报告未修改的 subagent-claude-code 文件问题。改动的声明粘贴及 JSDoc 未被这些检查报告为错误。全局 Agent Note 格式检查另报告未修改的 2026-09-12 记录不符合格式；本次新增记录未被报告。本次变更的 13 组中英文文档一致性、全仓相对链接、文档篇幅及 diff 空白检查通过。

模型响应使用测试替身，未访问真实 GPT/CPA，没有日常 DSH 安装、生产 UI 验收、原生压缩、跨模型检查点恢复或性能收益结论。测试中目录与进程由用例拥有并清理。
