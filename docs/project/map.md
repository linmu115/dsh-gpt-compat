# DSH GPT 兼容插件

让 GPT 在 DSH 中使用熟悉的工具与协议，同时保留 DSH 的会话、外部环境、权限和任务管理。选择绑定提供商时自动启用，切换其他提供商时恢复普通 DSH 路线。

**当前阶段：0.5.0-dev.3 副本接入与真实调用完成；Maintenance 扩展数据 Adapter 已部署验收。** 推理强度由模型能力声明。长任务与成本评估仍待验收，主实例未切换。

## 已经确定的行为

- 按提供商身份和模型范围绑定，每个会话独立生效，在安全步骤边界切换。
- 隐藏冲突的旧工具入口，保留底层服务；已有能力补齐，不等价的能力新建后路由。
- 原始历史持续保存；GPT 使用原生加密检查点，其他模型使用通用上下文，两条压缩路径独立触发。
- 两条路线都要接上对方工作期间新增的历史，停用、失败和重启不能使工作进度倒退。

完整边界、来源、容量差处理和验收条件见 [[REQ-gpt-compatibility|已确认需求]]。

## 模块与接口

| 模块 | 承担的职责 | 主要合同 |
|---|---|---|
| [提供商绑定与启停](records/modules/routing/overview.md) | 捕获本步骤选择、组装提示词、注册及撤销会话作用域 | [激活与请求配置](records/interfaces/profile.md) |
| [文件与进程工具](records/modules/tools/overview.md) | Codex 风格工具、输出语义、句柄和取消；继续使用 DSH 权限链 | [工具呈现与生命周期](records/interfaces/profile.md) |
| [协议与历史重放](records/modules/provider/overview.md) | API 声明、调用结果、特殊状态、CPA 原生压缩调用 | [上下文交付](records/interfaces/context.md) |
| [两版压缩与切换接续](records/modules/context/overview.md) | 从同一历史构造两种上下文，分别计量、保存和接续 | [检查点与历史边界](records/interfaces/context.md) |

绑定、工具、原生 Responses 协议、两版压缩控制与检查点接续已有代码；新版 CPA 原生压缩及恢复已经验收，副本 profile 已接入，Maintenance 扩展数据 Adapter 已在副本完成恢复和目录验收。整体组织图展示其边界；功能路径图展示一次请求的两种路由与失败保留行为。

## 从哪里继续

- [[OBJ-context|核心对象]]：原始历史、激活快照、检查点、后续历史与容量预算。
- [[INT-dsh|DSH 接入调查]]：已经存在的接口、必须补齐的部分及准确源码入口。
- [[IMP-current|目前做到哪]]：代码实现范围与开发缺口。
- [[VER-tools|工具首版验证]]：真实 Loader、文件、PowerShell 与组件测试，以及尚未通过的广域检查。
- [[VER-provider|原生协议验证]]：本机 HTTP、专用重放、设置快照及 compact 传输。
- [[VER-codex-v2|新版原生压缩验证]]：真实检查点、进程恢复、估计边界与失败处理。
- [[VER-cpa|上一阶段 CPA 验证]]：实际文件修改、进程重启后接续、压缩与计数限制。
- [[VER-map|地图验证]]：身份、图源与阅读入口；不替代业务验收。

本项目属于 DSH 系统地图的第六个独立维护对象。现成压缩方案、CPA 证据和 Harbor / Inspect AI 评估方向均保留为参考，不能据此宣称已经移植、安装或取得性能收益。

- [[INT-maintenance|Maintenance 接入]]：插件会话字段先构建扩展数据 Adapter，宿主身份保持不变。
