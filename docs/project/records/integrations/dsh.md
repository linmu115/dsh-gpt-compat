---
{
  "id": "INT-dsh",
  "kind": "interface",
  "title": "DSH 宿主接入与待补能力",
  "status": "current",
  "summary": "副本已接入路由准备、作用域工具、原生重放、双检查点与请求投影；普通 RC2 仍需对应宿主扩展。",
  "progress": "in_progress",
  "sources": [
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/core/agent/src/model-selection.ts",
      "role": "current-workspace-source"
    },
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/core/tools/src/index.ts",
      "role": "current-workspace-source"
    },
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/llm/llm/src/types.ts",
      "role": "current-workspace-source"
    },
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/core/system-prompt/src/index.ts",
      "role": "current-workspace-source"
    },
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/llm/llm-pi-ai/src/replay.ts",
      "role": "current-workspace-source"
    },
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/compaction/compaction/src/index.ts",
      "role": "current-workspace-source"
    },
    {
      "path": "../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/compaction/compaction-basic/src/index.ts",
      "role": "current-workspace-source"
    }
  ]
}
---

# DSH 宿主接入与待补能力

本项目作为 DSH 插件接入，DSH 继续拥有 Agent 循环、会话与基础执行环境。下表保留接入调查；工具与绑定实现进度见下方。

| 接入面 | 已发现基础 | 需要继续确定 |
|---|---|---|
| 模型选择 | 当前步骤捕获选择，提示组装与请求路由关联 | 设置页绑定、最终路由顺序、热切换收尾 |
| 工具 | 作用域注册、继承工具限制、撤销及执行权限链 | 精确的旧工具清单、新工具行为与 API 编码 |
| 提示词 | 按作用域组装提示和工具呈现 | GPT 兼容配置与 DSH 专有工具描述 |
| 历史重放 | 已有响应身份、文本及推理签名保存 | 当前 CPA 路线是否完整保留所需输入输出项 |
| 压缩 | 可替换压缩服务、上下文预算和摘要流程 | 两套独立检查点、路由选择和请求投影；不能只串行执行两次摘要 |

现有 DSH 冻结事件不能靠旁路写入破坏。若宿主缺少通用能力，应添加正式扩展点和版本化迁移；Codex 特有规则留在本插件。DSH 插件构建工具和其他业务工具按自身职责保留。

## 源码入口

- [model-selection](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/core/agent/src/model-selection.ts)
- [tool-registry](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/core/tools/src/index.ts)
- [tool-schema](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/llm/llm/src/types.ts)
- [prompt-assembly](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/core/system-prompt/src/index.ts)
- [replay](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/llm/llm-pi-ai/src/replay.ts)
- [compaction](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/compaction/compaction/src/index.ts)
- [compaction-basic](../../../../../../worktrees/gpt-compat-20260916/deepseek-harness/packages/compaction/compaction-basic/src/index.ts)

源码路径绑定到当前已查阅的工作树。后续选择其他 DSH 版本时重新核对，不以目录相邻或相同版本号代替接口兼容验证。

## 已补的通用扩展

- system-prompt：路由解析、浅冻结上下文、异步 prepare；随后才读取提示词与工具贡献。预览不改变执行状态。
- agent：模型选择提前捕获，并向组装传递实际路由；请求中间件仍负责最终路由。
- fs/fs-local/fs-sandbox：显式删除能力与基于已观察版本的单文件删除；保留当前路径沙箱检查。
- shell/bash-local/pwsh-local：交互 stdin 管道、输入关闭、受管范围终止及等待。

源码基于 `3a7508d20`，变更位于 `codex/gpt-compat` 工作树；普通 RC2 不能直接满足插件要求。宿主新增必读的压缩操作、检查点与请求投影事件，以及可撤销上下文所有权；普通请求仍保持 surface 派生。原生能力属于准备好的适配器，运行时拒绝跨范围密文；基础自动压缩在选择器活动时让出处理权。旧宿主不能安全读取这些新事件。
