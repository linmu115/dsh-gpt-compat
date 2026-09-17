---
{
  "id": "VER-model-catalog",
  "kind": "verification",
  "title": "自动模型目录与设置页验证",
  "status": "current",
  "summary": "b84e17b：自动发现五个 GPT 会话模型、只读设置页与会话选择器通过副本检查；64 项离线测试通过，不代表逐型号真实生成验收。",
  "sources": [
    {
      "path": "../settings-ui.md"
    },
    {
      "path": "../../tests/discovery.spec.ts"
    },
    {
      "path": "../../tests/bindings.spec.tsx"
    },
    {
      "path": "../../tests/accounts.spec.ts"
    }
  ],
  "relations": [
    {
      "relation": "verifies",
      "to": {
        "record_id": "MOD-routing"
      },
      "reason": "自动范围限本插件提供商"
    },
    {
      "relation": "verifies",
      "to": {
        "record_id": "MOD-provider"
      },
      "reason": "发现模型与能力快照"
    },
    {
      "relation": "verifies",
      "to": {
        "record_id": "MOD-accounts"
      },
      "reason": "固定账号的可用目录"
    },
    {
      "relation": "verifies",
      "to": {
        "record_id": "REQ-gpt-compatibility"
      },
      "reason": "设置只读展示，选择留在会话页"
    },
    {
      "relation": "verifies",
      "to": {
        "record_id": "IMP-current"
      },
      "reason": "对应 b84e17b 自动模型目录与副本交付"
    }
  ]
}
---

# 自动模型目录与设置页验证

验证日期 2026-09-17，实现提交 `b84e17b`，主插件 0.5.0-dev.3、账号模块 0.1.0；目标为 0.1.5-rc.2 副本。此记录整理上一轮实际结果，本次地图整理没有重新运行模型请求。

## 已验证

- 全量离线测试 64 项通过、1 项可选 live 测试跳过；最后补齐前端服务依赖及账号目录刷新通知后，相关 14 项测试复查通过。类型检查与客户端/服务端构建通过。
- 模拟测试覆盖账号目录与能力资料取交集、固定账号范围、暂停空目录、缺失容量拒绝、准备请求能力快照，以及外部提供商隔离。
- 实际副本目录返回 gpt-5.5、gpt-6-astra、gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna，共五个 GPT 会话模型。各型号附带 CPA 声明的推理档位；图片生成型号没有混入。
- GPT 设置页只读展示目录，仅有刷新操作，没有提供商/模型输入框或下拉选择。浅色、深色与独立 320px 卡片检查通过，修复后无页面脚本错误。
- 实际会话页的模型菜单包含上述五个型号，当前 GPT 的推理菜单包含 low、medium、high、xhigh、max；点击菜单外关闭，检查没有修改当前会话选择。
- 两个 CPA 账号仍可见，50 个已有内容的会话 ID 全部保留。空白入口按宿主生命周期重建，不以总行数变化判断已有会话丢失。
- 重新生成并校验 Maintenance 19 项绑定文件，经正式启动器启动成功；主实例配置指纹不变。

本机证据位于 `artifacts/auto-models-final-20260917/verification.json`、`conversation-ui.json` 与格式回执，含截图的私有材料不发布。公开说明见 [设置页验证](../../../settings-ui.md)，可复查的测试源码列于记录来源。

## 结论边界

此处证明模型发现、能力呈现、只读界面和副本接入。未逐个型号发送真实生成请求，未证明代理上游永远可用，也没有任务质量、性能、成本或时长收益结论。后续版本应重新检测当前 CPA 目录，不能把本次五个型号写成固定清单。
