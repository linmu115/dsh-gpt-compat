---
{
  "id": "VER-context",
  "kind": "verification",
  "title": "双检查点与跨模型接续验证",
  "status": "current",
  "summary": "36 项插件测试通过、1 项真实 API 跳过；宿主相关测试通过，SDK 快照和全仓文档编译受依赖缺失阻挡。",
  "relations": [
    {
      "relation": "verifies",
      "to": {
        "record_id": "IMP-current"
      },
      "reason": "核对压缩后的请求选择、持久化、切换、取消与恢复"
    }
  ]
}
---

# 双检查点与跨模型接续验证

开发版本 `0.3.0-dev.1`，隔离宿主 `codex/gpt-compat`，基础版本 `3a7508d20`。本记录只对本地模拟 HTTP 服务与源码组合负责，不证明实际 CPA 可用。

- 插件共 36 项通过、1 项 live 用例跳过。真实 Loader / agent loop 覆盖：原生压缩、完整返回窗口、普通大容量模型直接读取原文、容量降低后摘要、切回 GPT 分批补齐、JSON 存盘后创建新 agent 接续，以及卸载恢复普通历史。
- 覆盖保存候选失败、压缩途中取消、计数接口缺失及持久化期间源历史变动；这些失败均阻止不完整请求发送并保留原文。运行时直接拒绝不匹配的原生前缀，外部适配器收不到密文。工具配对测试不拆开并行调用的结果组。
- Session、agent-loop、compaction-basic 回归共 1,040 项通过、1 项跳过；另一个测试文件受共享依赖的子路径解析问题阻挡，使用只在测试中生效的源码别名后，该文件 15 项通过。别名配置保存在 artifacts/host-admission.config.ts，未修改共享依赖目录。
- LLM 与 agent 注册的另 358 项回归全部通过；持久事件目录与 scoped event 生成文件均通过新鲜度检查。
- 宿主相关包 TypeScript 构建、插件严格类型检查、422 项类型文档等价、11 对本阶段双语文档及文档预算检查通过。
- 全仓文档编译未通过：当前工作树缺 Electron、semver、tar 等依赖及部分生成声明。SDK multi-turn 快照未进入执行，缺 @agentclientprotocol/sdk。全仓 Agent Note 格式检查报告已有 2026-09-12-external-informational-append.md 不符合格式；本阶段新增说明未被该检查报告。

实际账号 API 用例未运行。原生检查点测试的计数与压缩由本地服务模拟；尚未证明 CPA 具有 /responses/input_tokens。未进行真实生产安装、跨进程恢复或 UI 操作验收。通用预算为保守文本估计，非精确 tokenizer。未得出开发智力、成功率、成本或时间改善结论。

构建产物为 `artifacts/dsh-gpt-compat-0.3.0-dev.1.tgz`，离线打包完成，包含共享原生协议模块、上下文接入说明与宿主补丁。宿主补丁 174,564 字节，已在未修改的原基线执行 `git apply --check`，没有实际应用或安装。

开发包 SHA-256：`26f72d38079fbeeac36e4604ea57dcdeef5fe634fea83f3f6c57d7c466ad993a`。
