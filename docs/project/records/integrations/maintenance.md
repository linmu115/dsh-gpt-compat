---
{
  "id": "INT-maintenance",
  "kind": "integration",
  "title": "独立会话格式接入 Maintenance",
  "status": "current",
  "summary": "五类持久事件由专属 Harness Adapter 读取，普通 V3 词表不变。",
  "relations": [
    {
      "relation": "consumes",
      "to": {
        "project_id": "0d05f813-7097-47d9-9e88-3d523bb537d6",
        "record_id": "IF-harness-adapter"
      }
    }
  ],
  "sources": [
    {
      "path": "../maintenance.md"
    }
  ]
}
---

# 独立会话格式接入 Maintenance

接口权威在 Maintenance 项目 `0d05f813-7097-47d9-9e88-3d523bb537d6` 的 `IF-harness-adapter`。本项目是消费者，具体配置见 docs/maintenance.md。

独立 Adapter `dsh-gpt-compat` 负责插件事件；模型切换不改变持久格式。旧联调重打包只是历史部署事实，新适配器源码完成不等于副本已升级。
