---
{
  "id": "EXP-menu-verification-state",
  "kind": "experience",
  "task_id": "HIST-model-discovery",
  "title": "菜单超时先核对当前层级和脚本动作",
  "date": "2026-09-17",
  "status": "current",
  "categories": [
    "debugging",
    "verification"
  ],
  "results": [
    "failed",
    "passed"
  ],
  "modules": [
    "会话模型菜单",
    "验证"
  ],
  "summary": "测试把 Escape 当成直接关闭，但宿主先返回上级，随后点击触发器关闭菜单，导致等待推理项超时。",
  "outcome": "修订检查步骤后模型和推理菜单均通过，未修改宿主菜单。",
  "applicability": "DSH GPT 兼容插件 0.5.0-dev.3、rc.2 副本；来自模型目录改造任务。",
  "coverage_note": "Codex 于 2026-09-17 根据所属任务的公开用户消息、源码操作和工具反馈整理。经验边界以当时实现为准。",
  "related_records": [
    "IMP-current",
    "VER-model-catalog"
  ]
}
---

# 菜单超时先核对当前层级和脚本动作

第一版会话菜单检查在等待“推理等级”时超时。这本身只证明检查脚本没有找到目标，不能直接证明产品不提供推理档位。

[查看依据：第一次菜单检查超时](history-event:EVT-81f2650fd6e8ddc7ac79)

继续查宿主源码确认：在二级列表按 Escape 会回到一级菜单，第二次才关闭。原脚本先按一次 Escape，再点触发器，实际把菜单关掉了。改为点击菜单外部关闭，再重新打开，并检查模型清单和推理档位，最终通过且没有改变会话选择。

[查看依据：源码注释及修订后成功结果](history-event:EVT-798a02a977303a0c2923)

保留首次失败是为了定位验证方法的条件，不是给产品贴上已修复菜单缺陷的标签。类似问题先读实际 UI 状态和交互合同，再决定需要改产品还是改测试。
