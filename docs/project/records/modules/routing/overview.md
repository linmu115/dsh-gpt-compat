---
{
  "id": "MOD-routing",
  "kind": "module",
  "title": "提供商绑定、提示词与会话启停",
  "status": "current",
  "summary": "按实际模型选择捕获配置，在作用域内注册工具和提示词，并处理切换及卸载。",
  "progress": "in_progress",
  "relations": [
    {
      "relation": "implements",
      "to": {
        "record_id": "REQ-gpt-compatibility"
      },
      "reason": "承接已确认的按会话启停要求"
    },
    {
      "relation": "provides",
      "to": {
        "record_id": "IF-profile"
      },
      "reason": "提供当前步骤的兼容配置"
    }
  ]
}
---

# 提供商绑定、提示词与会话启停

用户在会话页面选择模型；本插件自己的 Responses 提供商自动启用 GPT 兼容。其它提供商的高级显式绑定仍受原有规则约束。模块根据当前会话实际选择决定是否启用兼容配置，避免全局开关影响其他会话。

激活快照覆盖提示词组装、工具声明、请求路由和本次结果解释。已经发出的请求不得在处理中更换约定；模型选择变化进入后续安全步骤。提示词中的工具清单、环境信息及生成的工具 SDK 需与真实可见能力一致。

已注册的效果有明确所有者和撤销函数。停用前收尾正在执行的调用，对长进程保留明确的管理入口或完成取消，再撤销工具与提示词。继续保留 DSH 专有插件能力及基础服务。

输入输出及失败边界见 [[IF-profile|激活合同]]。路由准备接口与独立 GPT 设置页已实现，当前状态见 [[IMP-current]]。

## 实现状态

`src/index.ts` 在组装准备事件按实际模型路由启停作用域工具；模型选择变化从下一步生效。`src/client` 通过 `settings.section` 提供只读模型目录和账号管理。模型目录自动发现；`withNativeBindings` 按 `gpt-responses` 所有权目录补充 GPT 范围，同时供工具和上下文路径使用。高级显式绑定仍使用精确 provider ID 加明确模型名或尾部 `*`。

真实 Loader 与 agent loop 测试覆盖不同会话、切换竞争、预览不拆除工具、卸载与重新挂载。请求最终路由若在组装后被另一个插件改变则拒绝该步。原生 Responses 协议与副本安装已完成；推理强度按模型声明，具体范围见 [[IMP-current]]。
