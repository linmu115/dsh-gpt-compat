---
{
  "id": "EXP-model-settings-boundary",
  "kind": "experience",
  "task_id": "HIST-model-discovery",
  "title": "先分清兼容范围、可用目录与会话选择",
  "date": "2026-09-17",
  "status": "current",
  "categories": [
    "human-correction",
    "improvement"
  ],
  "results": [
    "not_adopted",
    "adopted"
  ],
  "modules": [
    "模型目录",
    "GPT 设置页"
  ],
  "summary": "原表单表示兼容范围，用户最终要求自动提供模型；把下拉框当成最终方案会保留错误的交互职责。",
  "outcome": "下拉编辑草稿未采用；设置只读，实际选择留在会话页。",
  "applicability": "DSH GPT 兼容插件 0.5.0-dev.3、rc.2 副本；来自模型目录改造任务。",
  "coverage_note": "Codex 于 2026-09-17 根据所属任务的公开用户消息、源码操作和工具反馈整理。经验边界以当时实现为准。",
  "related_records": [
    "IMP-current",
    "VER-model-catalog"
  ]
}
---

# 先分清兼容范围、可用目录与会话选择

最初截图中的列表是兼容范围，不是当前会话选择。用户提出下拉切换后，助手先澄清两种语义；用户随后要求不填写、不选择，直接提供全部 GPT 模型。

[查看依据：最终用户澄清](history-event:EVT-a9915ffacacdeafd0441)

因此需要同时改变界面和后台：撤掉编辑草稿，自动发现可用型号和能力，自动计算本插件提供商的兼容范围，再由会话页执行选择。只把 textarea 换成下拉框，或只隐藏输入框，都不能满足这个目标。

本任务里的下拉方案标为未采用，而非测试失败。复用时先判断控件改变的是“可用范围”还是“当前选择”，再决定是否需要选择器；不能据本案例推断所有设置页都禁止下拉框。
