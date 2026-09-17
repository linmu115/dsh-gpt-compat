# CPA 账号面板

2026-09-17 用户要求在 GPT 兼容插件自己的设置区提供当前账号、额度、切换账号、添加账号登录与退出登录入口。

账号与登录由 CPA 管理，DSH 只持有管理接口凭据引用，不复制 GPT access/refresh token。后续明确要求：保存多个登录账号，但代理只能固定使用指定账号，不允许额度耗尽、限流或请求失败后自动换号。新增账号仅进入待用列表。固定选择对这台 CPA 的全部 Codex 客户端生效；正在执行的请求保留已捕获的账号。退出登录表示从 CPA 移除该账号的本地凭据，不表示注销所有设备上的 OpenAI 会话。

账号控制作为可选的 `dsh-gpt-compat-accounts` 模块安装，通过 DSH 已认证的 Connection Fetch 接口提供有限操作；与会话格式、重放和 Maintenance 扩展数据 Adapter 分离。界面仍归属于 GPT 兼容设置区。

验收要求：账号列表不泄露令牌；额度缺失或失败不能显示为零；切换前重新核对账号池修订；切换启用失败保持所选账号并停止请求，不恢复成轮换或自动使用旧账号；注销须在界面确认具体账号；管理密钥只写入 DSH credentials；使用 CPA 原有 OAuth 登录与状态查询，回调由 CPA 接收。

## 使用与安装

入口为“设置 → 模型 → CPA 账号”，沿用 GPT 兼容工具的 DSH 原生按钮、输入框、卡片与主题颜色。首次连接后，从账号卡片点击“设为代理账号”，确认后才启用固定代理。新增账号保留待用；移除当前账号会先暂停代理；移除待用账号不改变当前选择。原有路由状态不伪装成已经固定某个账号。

`node scripts/build.mjs` 同时生成主插件与 `packages/accounts/lib/index.mjs`。把 `packages/accounts` 打包为独立 DSH bundle，通过宿主插件安装入口安装，并让该包的 `cordis.patch.yml` 生效。它注入 `connection` 和 `credentials`，默认连接本机 `http://127.0.0.1:8317`。账号管理模块与会话格式插件分包，升级它不需要更改 Maintenance 的 Harness 或扩展数据 Adapter。

面板使用 DSH 已认证的 Connection Fetch 路由；管理密码只保存在服务器端 credentials 中。服务只允许 HTTP loopback 端点，拒绝 URL 凭据、路径及重定向。OAuth 登录由 CPA 生成官方登录地址，在外部浏览器完成；DSH 只轮询不透明的短期登录句柄。

## CPA 接入边界

需要 [CPA 固定账号补丁](../host-patches/cpa-fixed-account.patch)，上游基线及唯一接口合同见 [补丁说明](../host-patches/cpa-fixed-account.md)。原版 CPA 的优先级和 fill-first 仍可能自动换号，不能替代该扩展。遇到不支持固定账号合同的 CPA，面板明确失败，不执行选号或移除。

账号模块通过 `gptCpaAccounts.identity(endpoint)` 向原生 Responses 适配器提供当前固定身份；适配器把身份纳入重放与原生检查点范围，并传递准备时的身份。切换后旧准备请求被拒绝，下一步骤从兼容历史重建。该集成仅对匹配的 CPA origin 生效。

管理密码未知时，可使用补丁新增的 `--local-management-password-file` 提供独立的本机密码，保留 CPA 原管理密码；常驻服务器不启用桌面控制器的心跳退出机制。密码文件由部署者保管，启动 CPA 时须继续传入该选项。此密码与模型 API Key、GPT 登录密码均不同。

固定代理影响这台 CPA 的全部 Codex 客户端，不是每个 DSH 会话独立选账号。Home 集群调度不支持固定模式并拒绝请求。本功能不保证避免平台限制。验证记录见 [[VER-accounts]]。
