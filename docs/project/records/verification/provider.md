---
{
  "id": "VER-provider",
  "kind": "verification",
  "title": "原生协议与重放验证",
  "status": "current",
  "summary": "28 项离线测试通过；本机 HTTP、真实 Loader/agent loop 和临时文件；真实 API 用例默认跳过，双检查点未验收。",
  "relations": [
    {
      "relation": "verifies",
      "to": {
        "record_id": "IMP-current"
      },
      "reason": "覆盖原生工具、专用重放、请求快照与独立 compact 传输"
    }
  ]
}
---

# 原生协议与重放验证

2026-09-16，开发版本 `0.2.0-dev.1`。此前工具验证的宿主基线和广域测试限制继续见 [[VER-tools|首版验证]]。本阶段没有新增宿主修改。

- 插件离线测试 28 项通过：原有 13 项，加 13 项 Responses 协议/异常测试、1 项原生 Loader 集成、1 项连接设置快照与卸载测试。真实 API 检查另有 1 项，未提供显式 live 配置而跳过。
- 本地 HTTP 测试检查 custom 声明、纯文本补丁、原生结果类型、完整 reasoning/output 重放、usage 中缓存扣分、SSE 分块、取消、截断、重复调用、未知 custom tool、大小上限及错误分类。404 compact 只失败一次，不静默改用普通生成。
- 真实 Cordis Loader 与 DSH agent loop 执行临时文件补丁；下一请求发送 custom_tool_call_output。日志写入 JSON 后由 Session 重建，仍可发送专用状态。切到外部适配器不发送加密状态，切回后恢复，历史工具不再次执行。
- 设置测试检查旧请求快照、新请求采用新端点、非法容量与重复路由在保存前拒绝，卸载后清理路由与提供商目录。
- TypeScript 严格源码检查和 backend/client bundle 构建通过。离线打包生成 `artifacts/dsh-gpt-compat-0.2.0-dev.1.tgz`，包含可选 `./responses` 导出和接入说明；宿主补丁沿用前阶段版本。
- 构建产物直接用 Node 加载时，当前开发目录未安装的 peer 包 `@deepseek-ai/dsh-llm` 导致解析失败。因此没有宣称发布包独立运行或生产安装验证通过；源码组合测试使用开发路径解析，二者不是同一证据。

没有真实 CPA 请求，没有生产安装或性能收益证据。compact 测试只证明传输和完整窗口返回，不证明自动触发、检查点提交、跨模型接续或重启恢复。
