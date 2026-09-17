---
{
  "id": "MOD-accounts",
  "kind": "module",
  "title": "CPA 账号与固定代理",
  "status": "current",
  "summary": "在 GPT 设置区管理多个账号和固定代理，并向原生提供商交付账号可用模型与能力资料；凭据由 CPA 保管。",
  "progress": "in_progress",
  "relations": [
    {
      "relation": "consumes",
      "to": {
        "record_id": "MOD-provider"
      },
      "reason": "原生请求捕获账号身份并隔离加密重放范围"
    }
  ]
}
---

# CPA 账号与固定代理

用户于 2026-09-17 明确要求：设置区显示当前 GPT 账号和额度，可以新增、移除账号；平时只代理指定账号，不在账号间轮换。新增账号与设为当前账号是两个操作。

设置面板通过 DSH 认证接口调用可选账号模块，模块使用服务器 credentials 调用 CPA 管理接口。CPA 持有 OAuth 凭据，并在重试前固定请求账号。额度不足、账号缺失或失败时停止；已经发出的请求保留原选择。额度未知不显示成零，移除前确认具体账号。

账号控制与 Maintenance 会话扩展数据互不替代；后者继续使用已有 `gpt-compat` 扩展数据 Adapter，不新增 Harness Adapter。本模块不复制 access/refresh token，也不改变宿主会话格式。

安装、接口归属与使用边界见 [账号接入说明](../../../../accounts.md)。源码入口：`src/accounts/host.ts`、`src/accounts/cpa.ts`、`src/client/Accounts.tsx`；CPA 独立补丁及权威合同随仓库提供。验收见 [[VER-accounts]]。

模型发现同样通过管理接口只读完成：将账号可用型号与 CPA 容量、推理能力资料取交集，交给原生 Responses 目录；固定账号、暂停与失败边界见 [[IF-profile]]。账号操作和发现变化会刷新会话目录。此能力的验证单列于 [[VER-model-catalog]]。
