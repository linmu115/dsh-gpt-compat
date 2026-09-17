---
{
  "id": "MOD-tools",
  "kind": "module",
  "title": "文件编辑与长进程工具",
  "status": "current",
  "summary": "新工具替换冲突入口，复用可兼容的底层服务；必要时独立实现行为。",
  "progress": "in_progress",
  "relations": [
    {
      "relation": "implements",
      "to": {
        "record_id": "REQ-gpt-compatibility"
      },
      "reason": "承接编辑和进程替换要求"
    },
    {
      "relation": "consumes",
      "to": {
        "record_id": "IF-profile"
      },
      "reason": "按作用域安装和撤销工具"
    }
  ]
}
---

# 文件编辑与长进程工具

文件工具以 Codex 风格补丁语法、结果和失败语义为目标。启用时隐藏冲突的 DSH 写入或编辑入口；读取与其他能力是否保留按实际职责决定，不把整个文件服务卸载。

命令工具可映射 DSH 进程服务，也可独立实现。无论采用哪一种方式，都必须拥有明确的工作目录、环境、进程句柄、输出读取位置、退出状态与取消行为。句柄不能串到其他会话；切换、热卸载和重启后的可恢复范围需明确验收。

隐藏后的旧工具不能通过同一受限作用域被继续转发。新工具调用基础服务或正式内部接口，并保留权限、审批、日志和调度约束。仅更换工具名称不构成兼容完成。

工具声明与请求编码由 [[MOD-provider|提供商适配]] 配合；生命周期由 [[IF-profile|激活合同]] 约束。将参考开源 Codex 的具体实现，复用范围和工具协议版本仍待锁定。

## 实现状态

`src/tools.ts` 注册 `apply_patch`、`exec_command`、`write_stdin`，直接使用调用方 agent 的 DSH 文件及 shell 服务。旧入口默认隐藏 write/edit/str_replace_editor/bash/pwsh；其他工具保留。隐藏工具的执行请求也会被拒绝。

补丁走 JSON 参数，语法实现精确匹配子集，拒绝歧义；多文件修改不是原子事务。命令通过 shell-env 继承受管 DSH 会话变量，使用配置的 shell 和管道，没有 PTY、每次调用换 shell 或重启恢复。真实文件、PowerShell 输入输出、跨会话句柄拒绝、切换与热卸载已验证；原生工具传输格式待提供商模块实现。
