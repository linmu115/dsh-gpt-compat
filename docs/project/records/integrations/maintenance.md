---
{
  "id": "INT-maintenance",
  "kind": "integration",
  "title": "扩展数据接入 Maintenance",
  "status": "current",
  "summary": "五类持久事件由插件扩展 Adapter 解释，宿主 Harness 身份保持不变。",
  "relations": [
    {
      "relation": "consumes",
      "to": {
        "project_id": "0d05f813-7097-47d9-9e88-3d523bb537d6",
        "record_id": "IF-extension"
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

# 扩展数据接入 Maintenance

接口权威在 Maintenance 项目 `0d05f813-7097-47d9-9e88-3d523bb537d6` 的 `IF-extension`。本项目是消费者，具体配置见 docs/maintenance.md。

插件扩展 namespace `gpt-compat` 负责事件校验与只读面板，宿主维持 `dsh-0.1.5`。旧独立 Harness 方案是职责误解，已撤销；历史来源身份保留。最新验证和部署以 Maintenance 的 INT-gpt-format 与 HIST-gpt-extension-boundary 为准。
