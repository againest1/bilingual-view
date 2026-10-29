# Bilingual View 使用指南

用中文输入，译好后发送，再用中文阅读和核对回答。本指南带你完成一轮双语对话，并说明翻译失败时如何继续。

如果已经完成 [README 的快速开始](README.md#快速开始)，可以直接跳到[发送中文提示词](#发送中文提示词)。

[安装与配置](#安装) · [日常使用](#使用与操作) · [失败与重试](#翻译失败时的处理) · [翻译范围](#输入翻译范围) · [常见问题](#常见问题) · [问题反馈](#问题反馈与诊断) · [数据与缓存](#数据与翻译缓存) · [更新与卸载](#更新与卸载) · [命令速查](#bilingual-view-命令)

## 使用要求

- 支持 Mods 的 Claude Code 交互式终端会话或 Desktop 会话。本文介绍的显示与设置控件可在这些界面中使用。
- 兼容 OpenAI Chat Completions 接口的翻译服务、翻译模型，以及该服务要求的 API 密钥（如需）。

安装插件后即可在 Claude Code 中使用，无需另外安装运行环境或启动辅助服务。

## 安装

在系统终端运行以下命令，将插件安装到当前用户范围：

```sh
claude plugin marketplace add againest1/bilingual-view
claude plugin install bilingual-view@bilingual-view
```

安装后启动新的 Claude Code 会话；已打开的终端会话也可以运行 `/reload-plugins`。输入框上方出现 **Bilingual View** 设置栏后，即可继续配置。设置栏中有 **On/Off（开启/关闭）** 按钮和 **Settings（设置）**。

不通过 Marketplace 安装时，可按[手动安装](#手动安装)操作，再回到下一节配置。

## 配置

### 填写翻译服务

点击输入框上方的 **Settings（设置）**，或运行 `/bilingual-view settings`。先填写服务地址、密钥和翻译模型：

| 设置项 | 填写说明 |
| --- | --- |
| Provider URL（服务地址） | 填写基础 URL，例如 `https://provider.example/v1`，并包含服务要求的路径前缀。支持 HTTP 和 HTTPS。 |
| API key（API 密钥） | 输入密钥并按 **Enter** 保存，成功后立即用于当前会话。输入时文本可见；服务无需身份验证时可不填。 |
| Model ID（模型标识） | 输入翻译模型的标识，或点击 **Fetch models（获取模型列表）** 后选择。这不会改变 Claude 会话使用的模型。 |
| Effort（思考强度） | 可选 **Provider default（服务默认）**、`none`、`low`、`medium`、`high`、`xhigh`、`max`，默认 `low`。详见[设置思考强度](#设置思考强度)。 |
| Translation（翻译） | 开启或关闭翻译，默认开启。 |

需要翻译的文本会发送到你配置的服务。密钥由 Claude 保存，中文原文和译文保存在本机；详见[数据与翻译缓存](#数据与翻译缓存)。

Provider URL 也可以填写完整的 `/chat/completions` 地址，**不要填写 `/models` 地址**。模型列表不可用时，直接填写 Model ID 即可。

保存后，可在输入框上方的设置栏核对模型和思考强度，例如 `Bilingual View · my-model(low)`。显示 **Not set（未设置）** 时，请填写 **Model ID**。

### 设置思考强度

在设置中选择 **Effort（思考强度）**，选择后立即生效，仅影响后续翻译。可运行 `/bilingual-view status` 核对当前档位。

**Provider default（服务默认）** 使用服务的默认思考设置，不代表关闭思考。

`none` 用于关闭思考；`low`、`medium`、`high`、`xhigh`、`max` 依次提高思考强度，更高档位可能增加用时和 token 消耗。

**选择具体档位时，翻译服务和模型必须支持 `reasoning_effort` 参数及该档位。** 不同模型支持的档位可能不同，`none` 也不是所有模型都可用。若服务提示参数或档位不支持，可选择 **Provider default** 或它支持的具体档位，再[测试连接](#测试连接)。

### 测试连接

点击 **Test connection（测试连接）**，或运行 `/bilingual-view check`。它会向你配置的翻译服务发送一条简短示例翻译请求，不会成为 Claude 会话中的消息。

示例翻译成功后，就可以开始发送中文提示词。如果失败，先检查服务地址、密钥和模型，再测试一次。

<details>
<summary><strong>更新模型列表或更换密钥</strong></summary>

需要更新模型列表时，点击 **Fetch models（获取模型列表）**。

更换密钥时，输入新值并按 **Enter** 保存。留空提交不会删除原有密钥。若无法保存，可运行 `/plugin`，选择本插件的 **Configure（配置）** 填写。

</details>

### 测试翻译速度

点击 **Test translation speed（测试翻译速度）**，或运行 `/bilingual-view speed`，用当前服务和模型翻译一段约 2,100 字符的固定英文样本。与连接测试一样，样本不会成为 Claude 会话中的消息。

选择 **Model ID（模型标识）** 和 **Effort（思考强度）** 时，建议用长文测速比较不同组合，优先选择在 **15 秒（15s）内** 返回完整译文的组合。超过 15 秒时，可尝试降低 Effort 或更换响应更快的模型后再测。

完成后可查看用时，例如 `8.42s`。**单次翻译请求的超时时间为 30 秒（30s）**；超时或失败时，按[失败处理](#失败后如何继续)排查。测速用于比较不同服务和模型，实际消息的翻译时间会随长度和内容变化。

## 使用与操作

### 发送中文提示词

确认设置栏为 **On（开启）**，像平常一样输入普通中文提示词。例如，发送 `解释这段代码` 后：

1. Bilingual View 先将提示词翻成英文，例如 `Explain this code.`。
2. 翻译成功并通过检查后，英文译文才会提交给 Claude。
3. 界面保留你输入的 `解释这段代码`，方便继续用中文阅读。

实际译文由你选择的翻译模型决定。**这就是「译好再发送」：失败时本次输入不会提交，也不会自动改发中文原文。** 你可以修正设置或重试，具体见[发送前的翻译检查](#发送前的翻译检查)。

看到 **Translating to English...（正在翻译为英文）** 时，请等待翻译完成；此时提示词尚未发送给 Claude。

### 查看已发送文本和原始回答

Claude 给出符合[中文显示范围](#中文显示范围)的英文最终回答后，Bilingual View 会生成中文译文供你阅读。要核对措辞，可以随时切换：

| 消息类型 | 切换到已发送文本或原文 | 切换回中文 |
| --- | --- | --- |
| 用户提示词 | **View sent text（查看已发送文本）** | **Show Chinese（显示中文）** |
| Claude 的最终回答 | **View original（查看原文）** | **Show Chinese（显示中文）** |

这些控件位于已翻译消息的下方。**View sent text（查看已发送文本）** 展示实际提交的内容，包括其中保留的中文。**提交前没有译文预览。**

翻译完成后，切换按钮旁可查看 **Translated in 1.24s（翻译用时 1.24 秒）**，表示生成当前译文所用的时间；较早的消息可能不显示用时。要比较不同服务或模型，请使用[测试翻译速度](#测试翻译速度)。

### 在提问对话框中回答

Claude 通过 `AskUserQuestion` 提问时，问题和选项描述可显示中文译文。选项名称保留原文，中文翻译附在选项描述中，方便对照。

直接选择选项时，按选项原文提交；自行输入中文回答，则译成英文后提交。如果同时选择选项并补充文字，只翻译自行输入的部分。翻译失败时，本次回答不会提交，请按[失败处理](#失败后如何继续)修正设置后重新作答。

### 开启或关闭翻译

点击输入框上方的 **On/Off（开启/关闭）**，或使用 `/bilingual-view on` 和 `/bilingual-view off`。

**关闭翻译后，中文输入会按原样提交。** 消息也会显示原文。重新开启翻译后，后续输入和界面显示恢复正常翻译行为，但已发送给 Claude 的中文不会被补译。

## 翻译失败时的处理

### 发送前的翻译检查

「译好再发送」适用于**翻译开启时，需要翻译的中文提示词和 `AskUserQuestion` 中自行输入的中文回答**。只有翻译成功、译文通过检查，输入才会提交。以下情况都会停止提交：

- 尚未配置翻译服务。
- 翻译请求失败，或译文改动了应保持原样的代码、路径等内容。
- 译文中本应翻成英文的自然语言部分仍含中文。

代码、路径等[保留文本](#翻译时保持原样的文本)中的中文会原样保留；命令和选中的选项请参阅[不会翻译的输入](#不会翻译的输入)。

### 失败后如何继续

输入翻译失败时，提示 **Your message was not submitted（消息未提交）**；在 `AskUserQuestion` 对话框中自行输入的回答则提示 **Your typed answer was not submitted（自行输入的回答未提交）**。

根据错误提示或 HTTP 状态码，在下表中查找处理办法：

| 提示中的原因或状态码 | 处理建议 |
| --- | --- |
| Provider URL / Model ID 未设置，或 URL、密钥格式错误 | 打开 `/bilingual-view settings`，补齐或修正对应字段。 |
| `HTTP 401` / Authentication failed | 检查 API 密钥、账号访问权限及服务配置的 IP 白名单。 |
| `HTTP 403` / Access denied | 检查账号权限和服务支持的地区。 |
| `HTTP 404` / Resource not found | 核对 Provider URL 和 Model ID。 |
| Credits exhausted / Insufficient quota | 按提示补充余额或检查额度。 |
| Organization / Project spending limit reached | 调整对应组织或项目的消费上限，或等待额度周期重置。 |
| Organization usage limit reached | 向服务商申请提高用量上限。 |
| Rate-limit error / Request rate increased too quickly | 降低请求频率，等待后重试。 |
| `HTTP 408` / Timed out；`HTTP 409` / Conflict | 稍后重试。 |
| Timed out (30-second limit) | 重试，或换用响应更快的翻译模型。 |
| Failed without an HTTP response | 检查连接和 Provider 设置，再重试。 |
| `HTTP 400` / `422` | 对照服务的请求要求检查配置；若提示 `reasoning_effort` 或档位不支持，按[思考强度说明](#设置思考强度)调整。 |
| Model is temporarily overloaded / `HTTP 5xx` | 稍后重试或查看服务状态。 |
| Specific cause could not be determined | 根据 HTTP 状态查阅服务的错误说明，或联系服务商。 |
| Invalid JSON / Incompatible response format | 检查服务的 Chat Completions 接口兼容性。 |
| Token limit / Empty content / Reasoning tags / Tool call | 按提示检查输出 token 上限，或选择直接返回译文的模型。 |
| Content filter | 查阅翻译服务的内容政策。 |
| Model returned a refusal | 查看服务返回的拒绝说明。 |
| Left Chinese / Could not preserve code, paths or other protected text | 译文未通过检查；重试或更换翻译模型。 |
| Translation canceled | 本次翻译已取消，需要时重新发送。 |

**单次翻译请求的超时时间为 30 秒（30s）。** 连接测试通过后，长文本翻译仍可能超时。经常超时时，可用[测试翻译速度](#测试翻译速度)比较不同模型，选择响应更快的组合。

| 失败发生在哪里 | 消息状态 | 接下来怎么做 |
| --- | --- | --- |
| 发送普通中文提示词时 | 本次提示词未发送给 Claude。 | 修正设置后重新发送，或重试。 |
| 在 `AskUserQuestion` 中自行输入回答时 | 该回答未提交。 | 修正设置后，在重新出现的提问中作答。 |
| 阅读 `AskUserQuestion` 的问题和选项时 | 可先阅读原文并作答。 | 修正设置后点击 **Retry translation（重试翻译）**；对话框已关闭时，在聊天记录中找到该提问再重试。 |
| 阅读中文译文时 | 原文仍可阅读；Claude 已生成的回答不受影响。 | 点击 **Retry translation（重试翻译）**。 |

长文本显示翻译失败时，**Retry translation（重试翻译）** 会复用已经通过检查的分段，只补译失败或尚未完成的分段。这些分段进度仅保留在内存中；重载插件、重启会话或因容量限制被清理后，再次重试会重新翻译。完整译文仍按[缓存规则](#数据与翻译缓存)保存。

如果决定暂时关闭翻译，**关闭后重新发送的中文会原样提交给 Claude**，后续开启翻译也不会补译这次输入。

## 输入翻译范围

> **Claude 仍可能收到中文。** 斜杠命令及其中的中文参数不会被翻译。保留文本、已有历史记录、文件和其他上下文中的中文也不在输入翻译范围内。屏幕上显示中文消息，并不代表 Claude 收到的也是中文。

### 提交前会翻译的输入

在受支持的交互式会话中，翻译处于 **On（开启）** 状态时：

| 输入内容 | Claude 收到的内容 |
| --- | --- |
| 普通中文提示词 | 自然语言部分的英文译文，下文列出的保留内容维持原样。 |
| 在 `AskUserQuestion` 对话框中自行输入的中文回答 | 输入文本的英文译文。如果同时选择了选项，选项仍按原文提交。 |

输入中没有需要翻译的中文正文时，会原样提交。代码、路径等[保留文本](#翻译时保持原样的文本)中的中文也会保留。

### 不会翻译的输入

| 输入内容 | 处理方式与影响 |
| --- | --- |
| **斜杠命令及其参数** | **整条命令保持原样**，包括内置命令、自定义技能和插件命令中的自然语言参数。 |
| `!` Shell 命令 | 命令及其参数、输出保持原样，包括其中的中文。 |
| `AskUserQuestion` 对话框中选中的选项 | 按选项原文提交，不会将选中的中文选项译成英文。 |
| 翻译处于 **Off（关闭）** 状态时的输入 | 按原样提交，包括中文提示词和在 `AskUserQuestion` 中自行输入的回答。 |
| 自动提交的提示词 | 来自插件、通知、无界面 CLI 或独立 SDK 自动化的提示词保持原样。 |
| 其他输入框和对话框 | 上述自由文本翻译适用于 `AskUserQuestion`，并不覆盖所有文本输入框或权限对话框。 |

例如，`/statusline 加入 sessionID` 会按输入原样提交。要用英文发送这条指令，需要自行输入 `/statusline Add sessionID`。以 `/` 或 `!` 开头的输入都会原样提交。

### 翻译时保持原样的文本

以下内容在翻译时保持原样，包括其中的中文：

- 行内代码、围栏代码块，以及四空格或 Tab 缩进代码块，包括其中的标识符、注释和字符串值。
- URL、Markdown 链接及其显示文字、文件引用、`@` 提及和路径。
- 常见的 LaTeX 公式。
- 句子中的引号文本。整条输入只有一段引号文本时，这段内容仍会翻译。
- 以粘贴块显示的内容。直接出现在输入框里的普通粘贴文本，与手动输入一样处理。

例如，在 `将按钮文字改为“提交”` 中，指令会被翻译，`“提交”` 会保留中文。

使用缩进代码块时，请在正文与代码之间留一个空行，并缩进四个空格或一个 Tab；列表中的代码要比列表正文多缩进四个空格。

需要核对保留内容和格式时，可使用 **View original（查看原文）** 或 **View sent text（查看已发送文本）**。

### 其他上下文不会转为英文

已有会话历史、文件、`CLAUDE.md` 等项目指令、技能内容、普通工具结果及附件不会自动译成英文，其中的中文仍可能被 Claude 读取。

## 中文显示范围

译文只供阅读，不会改写会话历史，也不要求 Claude 用英文回答。

| 内容 | 显示方式 |
| --- | --- |
| 新翻译的用户提示词 | 通常显示你输入的中文原文。**View sent text（查看已发送文本）** 可显示实际提交的版本。 |
| 较早的用户消息 | 可阅读已保存的中文原文或译文；没有译文的英文消息可在浏览时补译。 |
| 主会话中的最终回答 | 英文最终回答可显示中文译文。**View original（查看原文）** 可显示 Claude 的原始回答。 |
| `AskUserQuestion` 对话框及其显示结果 | 问题和选项描述可显示中文译文；选项名称保留原文，中文翻译附在选项描述中。自行输入的中文回答仍可按原文阅读。 |
| 思考过程、中间回复、普通工具调用及结果、命令输出和子代理消息 | 保持原样。 |

中英混合的消息如果没有译文，其中的英文不会自动补译。代码、路径等保留文本中的中文不影响英文正文的翻译。提问对话框中的英文问题和选项描述仍可翻译，即使其他部分已是中文。

## 常见问题

<details>
<summary><strong>安装后看不到设置栏</strong></summary>

先确认使用的 Claude 宿主支持 Mods，再按安装方式检查：

- **Marketplace 安装：** 在 `/plugin` 的 **Installed** 页面确认 `bilingual-view@bilingual-view` 已安装并启用，然后启动新会话，或在终端会话中运行 `/reload-plugins`。
- **手动安装：** 检查 `.claude-plugin` 和 `hooks` 是否直接位于 `~/.claude/skills/bilingual-view/` 下，然后启动新会话。

</details>

<details>
<summary><strong>获取模型列表时返回 HTTP 404</strong></summary>

检查 Provider URL 是否以 API 基础路径（如 `/v1`）或 `/chat/completions` 结尾。如果服务不提供 `/models` 接口，请手动填写 Model ID，再运行 `/bilingual-view check` 测试翻译。

</details>

<details>
<summary><strong>开启翻译后，Claude 为什么还会收到中文？</strong></summary>

命令参数、代码等保留文本、选中的选项，以及已有历史和文件中的中文都会保留。关闭翻译时，中文输入也会原样提交。完整规则见[输入翻译范围](#输入翻译范围)。

要核对普通提示词实际发送的内容，可在已翻译消息下方点击 **View sent text（查看已发送文本）**。

</details>

<details>
<summary><strong>回答或较早的消息没有显示中文译文</strong></summary>

先确认翻译处于 **On（开启）** 状态。中英混合的自然语言文本直接显示，思考过程、中间回复和普通工具结果不翻译，详见[中文显示范围](#中文显示范围)。如果已经出现翻译失败提示，可点击 **Retry translation（重试翻译）**。

如果问题仍然存在，可按[问题反馈与诊断](#问题反馈与诊断)中的说明提供现象和诊断信息。

</details>

<details>
<summary><strong>恢复会话后找不到最初输入的中文措辞</strong></summary>

缓存可能已被删除、因达到容量上限而移除较早的记录，或未能成功保存。重新生成的显示译文无法还原你当时输入的准确措辞。保存位置和限制见[数据与翻译缓存](#数据与翻译缓存)。

</details>

## 问题反馈与诊断

向开发者反馈 Bilingual View 的问题时，可在相关会话中导出近期诊断信息，帮助排查：

```text
/bilingual-view diagnostics
```

文件保存到 `~/.claude/bilingual-view/diagnostics.json`，**不会自动上传**，可由你选择是否附在反馈中。文件包含诊断状态及会话、消息 ID，不含消息正文、译文或密钥。

请在问题发生后尽快导出，并在**重载插件或重启会话前**完成。每次导出会覆盖上次文件，需要保留时请先另存。卸载插件不会删除已导出的文件，可自行删除。

反馈时，请尽可能提供：

- 复现步骤、预期行为和实际现象，以及问题发生的时间。
- Claude Code 和插件版本、安装方式，以及使用的是终端还是 Desktop 界面。
- 导出的诊断文件；如需补充截图或示例，请先检查其中是否有不希望分享的内容。

## 数据与翻译缓存

需要翻译的文本会发送到你配置的翻译服务，包括受支持提示词中的自然语言内容、在 `AskUserQuestion` 中自行输入的回答，以及需要翻译显示的文本。Mod 不会在每次翻译时发送整个会话。翻译服务凭据通过 Claude 的配置管理。

中文原文和译文统一保存在 `~/.claude/bilingual-view/cache/`，与 Claude 的会话历史分开存储。手动安装和 Marketplace 安装使用同一个固定目录，更新插件或更换安装目录后仍可读取已保存的内容。

每个会话的缓存最多占用 4 MiB；缓存文件达到上限时，较早的记录可能被移除。卸载插件会保留缓存，需要删除时请按[清理翻译缓存](#清理翻译缓存)操作。删除缓存也会删除已保存的译文和中文原文；后续重新翻译无法还原你最初输入的准确措辞。

同一会话请勿同时在多个 Claude Code 实例中使用，以免丢失已保存的中文文本。

## 手动安装

从 [GitHub 仓库](https://github.com/againest1/bilingual-view)下载并解压 Bilingual View，或复制本项目目录。在包含 `plugins` 的项目根目录中运行：

```sh
mkdir -p "$HOME/.claude/skills/bilingual-view"
cp -R plugins/bilingual-view/.claude-plugin plugins/bilingual-view/hooks "$HOME/.claude/skills/bilingual-view/"
```

启动新的 Claude Code 会话。看到输入框上方的 **Bilingual View** 设置栏后，按[配置](#配置)填写翻译服务，即可开始使用。

## 更新与卸载

### Marketplace 方式

更新市场目录并更新插件：

```sh
claude plugin marketplace update bilingual-view
claude plugin update bilingual-view@bilingual-view
```

更新后启动新会话，或在已打开的终端会话中运行 `/reload-plugins`。

如需自动更新，在 `/plugin` 的 **Marketplaces** 页面选择 **bilingual-view**，再启用 **Enable auto-update**；第三方市场默认不自动更新。

卸载插件：

```sh
claude plugin uninstall bilingual-view@bilingual-view
```

卸载后启动新会话，或在已打开的终端会话中运行 `/reload-plugins`。卸载插件会保留翻译缓存；如需彻底清理，请再[清理翻译缓存](#清理翻译缓存)。Claude 的会话历史不受影响。

如果也不再需要这个市场源，可以继续移除上文添加到用户范围的市场源：

```sh
claude plugin marketplace remove bilingual-view
```

更多命令用法见 [Claude Code 插件命令参考](https://code.claude.com/docs/en/plugins/cli-reference)。

### 手动方式

更新时，将新版 `plugins/bilingual-view/` 下的 `.claude-plugin` 和 `hooks` 目录复制到现有安装目录，然后启动新会话。翻译缓存保存在独立目录中，不受更新影响。

卸载时，删除 `~/.claude/skills/bilingual-view/` 并启动新会话。需要同时删除中文原文和译文时，再按下文[清理翻译缓存](#清理翻译缓存)删除缓存目录。Claude 的会话历史不受影响。

### 清理翻译缓存

两种安装方式的缓存都保存在 `~/.claude/bilingual-view/cache/`，卸载插件后仍会保留。不再需要已保存的中文原文和译文时，在关闭使用该 Mod 的会话后运行：

```sh
rm -rf "$HOME/.claude/bilingual-view/cache/"
```

这会删除所有会话的翻译缓存；重新翻译无法还原你最初输入的准确中文措辞。

## Bilingual View 命令

| 命令 | 功能 |
| --- | --- |
| `/bilingual-view` 或 `/bilingual-view status` | 显示当前翻译设置，不显示 API 密钥。 |
| `/bilingual-view settings` | 打开设置。 |
| `/bilingual-view on` | 开启翻译。 |
| `/bilingual-view off` | 关闭翻译。 |
| `/bilingual-view check` | 发送简短示例翻译请求并报告结果。 |
| `/bilingual-view speed` | 测试长文本翻译速度，并报告用时或失败原因。 |
| `/bilingual-view diagnostics` | 导出用于问题反馈的近期诊断信息到本机，不自动上传。 |

上表中的命令用于控制本 Mod。其他命令的翻译行为见[不会翻译的输入](#不会翻译的输入)。
