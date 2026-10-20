# @goodandready/dsh-opencode-provider

面向 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/)（dsh）的 OpenCode / OpenCode Go 提供商插件。

插件注册两个原生 LLM 路由：

| 路由 | 产品 | 基础地址 |
|---|---|---|
| `opencode` | OpenCode Console / Zen（按量付费） | `https://opencode.ai/inference` |
| `opencode-go` | OpenCode Go / Go Plus 订阅 | `https://opencode.ai/inference/go` |

密钥在每次请求时解析，因此更换凭据后无需重启即可生效。

## 功能

- 支持 OpenAI Chat、OpenAI Responses、Anthropic 和 Google 四种传输，可按模型选择。
- 从 `/v1/models` 读取实时目录，并有 models.dev 生成目录作为回退。
- Go 与 Go Plus 的 5 小时 / 每周 / 每月订阅额度估算。
- 计划感知的模型选择器（Go / Console / FREE）。
- 多账户轮换：401/403/429 或配额耗尽时切换到下一个账户；冷却按密钥指纹持久化。
- 账户健康、每账户配额、模型 → 账户规则。
- 用量分析面板、请求热力图、Models / Days / Sessions 表。
- 核心工具在 128 个工具上限内优先保留；工具结果图片转为占位符。
- Settings → OpenCode 中的一键插件更新。

## 安装

```bash
dsh plugin --profile web add @goodandready/dsh-opencode-provider@0.5.0
# DSH Desktop:
dsh plugin --profile desktop add @goodandready/dsh-opencode-provider@0.5.0
```

也可以安装打包文件：

```bash
dsh plugin --profile web add /absolute/path/to/goodandready-dsh-opencode-provider-0.5.0.tgz
```

安装后重启 dsh / DSH Desktop，在模型选择器中选择 **OpenCode** 或 **OpenCode Go**。

## 配置

密钥来自 DSH 凭据服务、`OPENCODE_API_KEY` 或 `~/.local/share/opencode/auth.json`。Settings → OpenCode 可以粘贴、导入、清除密钥，并运行 **Test connection**。

默认账户优先使用；额外账户按顺序作为回退。账户可按 credential reference 配置。`modelAccountRules` 使用大小写不敏感的 `*` / `?` glob，把匹配模型优先路由到指定账户，其余账户仍作为回退。

Go 路由使用配额表：5 小时、每周、每月窗口，以及每月美元额度。网关仍是最终权威；插件中的请求数是估算值。

## 配额和分析

侧边栏配额卡默认关闭，可在 Settings → OpenCode 打开。点击卡片打开完整面板，显示账户、5h/周/月剩余额度、重置时间、用量分析和请求热力图。

热力图按本地时间聚合真实适配器请求，排除 `session-title` 和 `compaction`，精确重复记录会折叠。数据只写到 `~/.dsh/storages/dsh-opencode/requests.jsonl`，不包含提示词、响应或密钥。成本由 DSH 原生成本显示提供，本插件不添加第二个 composer 成本胶囊。

## 插件更新

Settings → OpenCode 的 **Plugin update** 卡片：

1. `GET /dsh-opencode/update` 比较已安装版本与 npm registry。
2. 有更新时显示徽章和 **Update now**。
3. 点击后通过正常的 `dsh plugin add` 安装精确版本；并发安装会被拒绝，不使用 `--force`，不会从 worktree 或 `file:` 安装。
4. 成功后提示重启 DSH。

如果运行时没有暴露 DSH CLI，卡片会说明自动更新不可用，并指向 DSH 插件管理器；状态检查仍然可用。

## 安全

- 写入路由要求 JSON、同源和 literal loopback Host（`127.0.0.1` / `::1`），阻止 DNS rebinding。
- 更新 POST 额外要求 loopback、同源和 `x-dsh-plugin-update: 1`。
- 密钥不会从 `/state` 返回，也不会写入日志。
- 写入请求体上限 256 KiB；请求日志只保存 `{at, provider, model, purpose}`。

## 兼容性

已针对 DSH **0.2.1-rc.2** 验证。UI 需要 web profile（Host 需要 `ctx.webServer`）；TUI 保留 `/opencode` 命令和模型路由。

## 限制

- 文件附件暂不转发；图片支持。
- 官方用量端点是非官方的，可能变化；聊天不依赖它。
- 自动更新需要运行时提供 DSH CLI；否则使用 DSH 插件管理器。
- 匿名免费通道（`Bearer public` + CLI 伪装）未实现。

## License

MIT。见 `LICENSE` 和 `NOTICE`。
