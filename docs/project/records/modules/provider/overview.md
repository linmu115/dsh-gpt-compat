---
{
  "id": "MOD-provider",
  "kind": "module",
  "title": "提供商协议与历史重放",
  "status": "current",
  "summary": "独立 Responses 入口已接通 custom tool、专用重放、配置快照与 compact 传输；显式 codex-v2 已通过真实 CPA 工具、压缩及跨进程恢复。",
  "progress": "in_progress",
  "relations": [
    {
      "relation": "implements",
      "to": {
        "record_id": "REQ-gpt-compatibility"
      },
      "reason": "负责协议与重放补齐"
    },
    {
      "relation": "consumes",
      "to": {
        "record_id": "IF-profile"
      },
      "reason": "使用本步骤固定的路由"
    },
    {
      "relation": "consumes",
      "to": {
        "record_id": "IF-context"
      },
      "reason": "接收符合当前路线的输入窗口"
    }
  ]
}
---

# 提供商协议与历史重放

模块负责将 DSH 当前请求转换为选定 GPT 路线接受的提示、工具声明、输入项和结果项，再将返回内容与必要专用状态保存回来。已完成工具结果直接使用，不因重建上下文而重新执行命令。

DSH 已有响应身份、文本与推理签名等重放元数据。先核对实际 GPT / CPA 路线缺什么，能补齐的沿用现有实现；不等价的协议处理由新适配器承担，按绑定规则路由。

原生压缩是此模块消费外部 API 的一项能力。独立 `/responses/compact`、普通请求里的服务端压缩以及 `compaction_trigger` 路线分别核对。必须验证请求控制项、流式事件、完整压缩输出和下一轮回传，不能仅凭普通聊天成功判断支持。

兼容检查点、普通历史与其他提供商专用状态分别处理。某个检查点不能用时，从原始记录重建原生上下文；不把通用摘要偷偷注入原生路线。现成实现与 CPA 调研证据见 [[REQ-gpt-compatibility|需求记录中的调研依据]]。

当前实现位于 `src/responses.ts`、`src/responses-wire.ts` 与 `src/responses-http.ts`，通过原生 DSH 适配器注册。完整输出保存在现有 ReplayEnvelope，跨路线降为可读历史。同端点 CPA 账号模块连接后，codex-v2 路线自动读取账号可用模型及 CPA 容量、推理能力；其它 Responses 路线仍使用显式容量配置。SSE 先缓冲至终态，尚未实时显示增量。准备好的适配器提供同一连接范围的原生编码、计数和 compact 能力，上下文模块负责检查点持久化及选择；当前 CPA 工具和普通重放已通过真实账号检查；codex-v2 通过普通 Responses 执行原生压缩，使用本地预算估计；旧 compact 和计数路由限制仍在，详见 [[VER-codex-v2|新协议验证]]。

设计与使用说明见 `docs/responses.md`；离线集成证据见 [[VER-provider|原生协议验证]]。
