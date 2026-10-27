# Bilingual View 使用指南

用中文输入，译好后发送，再用中文阅读和核对回答。本指南带你完成一轮双语对话，并说明翻译失败时如何继续。

如果已经完成 [README 的快速开始](README.md#快速开始)，可以直接跳到[发送中文提示词](#发送中文提示词)。

[安装与配置](#安装) · [日常使用](#使用与操作) · [失败与重试](#翻译失败时的处理) · [翻译范围](#输入翻译范围) · [常见问题](#常见问题) · [问题反馈](#问题反馈与诊断) · [数据与缓存](#数据与翻译缓存) · [更新与卸载](#更新与卸载) · [命令速查](#bilingual-view-命令)

## 使用要求

- 支持 Mods 的 Claude Code 交互式终端会话或 Desktop 会话。本文介绍的显示与设置控件可在这些界面中使用。
- 兼容 OpenAI Chat Completions 接口的翻译服务、翻译模型，以及该服务要求的 API 密钥（如需）。

本 Mod 在 Claude Code 内部运行，无需单独安装 Node.js 运行环境、执行构建步骤或启动辅助服务。

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
| Translation（翻译） | 开启或关闭翻译，默认开启。 |

需要翻译的文本会发送到你配置的服务。密钥由 Claude 保存，中文原文和译文保存在本机；详见[数据与翻译缓存](#数据与翻译缓存)。

Provider URL 也可以填写完整的 `/chat/completions` 地址，**不要填写 `/models` 地址**。模型列表不可用时，直接填写 Model ID 即可。

### 测试连接

点击 **Test connection（测试连接）**，或运行 `/bilingual-view check`。它会向你配置的翻译服务发送一条简短示例翻译请求，不会成为 Claude 会话中的消息。

示例翻译成功后，就可以开始发送中文提示词。如果失败，先检查服务地址、密钥和模型，再测试一次。

<details>
<summary><strong>模型列表刷新与密钥保存说明</strong></summary>

模型列表仅在点击 **Fetch models（获取模型列表）** 时获取，不会自动刷新，也不会在 Mod 重新加载后保留。

密钥保存成功后，输入框清空并显示 **Set（已设置）**。更换密钥时输入新值并再次保存；留空提交不会清除或更改已有密钥。若提示密钥无法保存，可运行 `/plugin`，选择本插件的 **Configure（配置）** 填写。

</details>

### 测试翻译速度

点击 **Test translation speed（测试翻译速度）**，或运行 `/bilingual-view speed`。它会使用当前配置的翻译服务和模型，将内置的约 3,500 字符英文样本翻成中文。与连接测试一样，请求不会成为 Claude 会话中的消息。

样本会**整篇一次发送，不分片**，单次请求的超时时间仍为 **30 秒（30s）**。日常输入和显示翻译仍按长度分片。

成功后会显示完整翻译请求的用时，例如 `8.42s`；失败时会显示具体原因，可按[失败处理](#失败后如何继续)中的说明排查。测速用于了解当前模型的长文本翻译速度，成功也不能保证其他请求都不会超时。

## 使用与操作

### 发送中文提示词

确认设置栏为 **On（开启）**，像平常一样输入普通中文提示词。例如，发送 `解释这段代码` 后：

1. Bilingual View 先将提示词翻成英文，例如 `Explain this code.`。
2. 翻译成功并通过检查后，英文译文才会提交给 Claude。
3. 界面保留你输入的 `解释这段代码`，方便继续用中文阅读。

实际译文由你选择的翻译模型决定。**这就是「译好再发送」：失败时本次输入不会提交，也不会自动改发中文原文。** 你可以修正设置或重试，具体见[发送前的翻译检查](#发送前的翻译检查)。

翻译超过约 **0.3 秒** 时，设置栏会显示 **Translating to English...（正在翻译为英文）**，表示提示词尚未发送给 Claude。快速完成的翻译不会显示此提示；提示出现前也可能正在翻译。翻译完成、失败或取消后，提示会消失。

### 查看已发送文本和原始回答

Claude 给出符合[中文显示范围](#中文显示范围)的英文最终回答后，Bilingual View 会生成中文译文供你阅读。要核对措辞，可以随时切换：

| 消息类型 | 切换到已发送文本或原文 | 切换回中文 |
| --- | --- | --- |
| 用户提示词 | **View sent text（查看已发送文本）** | **Show Chinese（显示中文）** |
| Claude 的最终回答 | **View original（查看原文）** | **Show Chinese（显示中文）** |

这些控件位于已翻译用户消息的下方，以及已翻译最终回答的下方。**View sent text（查看已发送文本）** 展示实际提交的版本，包括其中按规则保留的中文；它查看的是已经发送的消息，提交前没有译文预览。斜杠命令会直接传递，不显示这些用户消息翻译控件。

翻译全部成功后，切换按钮旁会显示 **Translated in 1.24s（翻译用时 1.24 秒）** 这样的提示。用时覆盖生成当前译文的翻译与检查，包括分片和自动纠正；不含排队、Claude 生成回答或保存缓存的时间。手动重试时，已成功部分的用时会保留，加上本次补译成功部分的用时，不计入之前失败的尝试或等待重试的时间。

切换原文或恢复会话时，会保留生成这份译文时的用时；较早缓存没有记录用时的消息不显示数字。不同文本的长度和内容会影响用时，需要固定样本比较时可用[测试翻译速度](#测试翻译速度)。

### 在提问对话框中回答

Claude 通过 `AskUserQuestion` 提问时，问题和选项描述可显示中文译文。选项标签保留原始值，标签的译文放在描述中，方便对照。

直接选择选项，会提交选项的原始值；自行输入中文回答，则会先翻译并检查，再提交英文译文。如果同时选择选项并补充文字，只翻译自行输入的部分。翻译失败时，该回答不会提交，Claude 会收到失败通知并被要求重新提问。

### 开启或关闭翻译

点击输入框上方的 **On/Off（开启/关闭）**，或使用 `/bilingual-view on` 和 `/bilingual-view off`。

**关闭翻译后，中文输入会按原样提交。** 消息也会显示原文。重新开启翻译后，后续输入和界面显示恢复正常翻译行为，但已发送给 Claude 的中文不会被补译。

## 翻译失败时的处理

### 发送前的翻译检查

「译好再发送」适用于**翻译开启时，需要翻译的中文提示词和 `AskUserQuestion` 中自行输入的中文回答**。只有翻译成功、译文通过检查，输入才会提交。以下情况都会停止提交：

- 尚未配置翻译服务。
- 翻译请求失败，或译文未通过保留文本检查。
- 译文中本应翻成英文的自然语言部分仍含中文。

检查允许代码、路径等[保留文本](#翻译时保持原样的文本)包含中文。命令、选中的选项等[原样提交的输入](#不会翻译的输入)不经过翻译，也不受这项检查限制。

如果翻译服务改动或遗漏了应保留的文本，Bilingual View 会针对受影响的部分自动发起一次纠正请求。纠正仍失败时会报告问题，不会无限重试。

### 失败后如何继续

输入翻译失败时，提示 **Your message was not submitted（消息未提交）**；在 `AskUserQuestion` 对话框中自行输入的回答则提示 **Your typed answer was not submitted（自行输入的回答未提交）**。

接口报错优先显示服务返回的错误说明；缺少有效说明时，才使用下表的分类提示。

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
| Timed out (30-second limit) | 翻译请求触及宿主的 30 秒时限；重试或换用更快的翻译模型。 |
| Failed without an HTTP response | 检查连接和 Provider 设置，再重试。 |
| `HTTP 400` / `422` | 对照服务的请求要求检查配置。 |
| Model is temporarily overloaded / `HTTP 5xx` | 稍后重试或查看服务状态。 |
| Specific cause could not be determined | 根据 HTTP 状态查阅服务的错误说明，或联系服务商。 |
| Invalid JSON / Incompatible response format | 检查服务的 Chat Completions 接口兼容性。 |
| Token limit / Empty content / Reasoning tags / Tool call | 按提示检查输出 token 上限，或选择直接返回译文的模型。 |
| Content filter | 查阅翻译服务的内容政策。 |
| Model returned a refusal | 查看服务返回的拒绝说明。 |
| Left Chinese / Could not preserve code, paths or other protected text | 译文未通过检查；重试或更换翻译模型。 |
| Translation canceled | 本次翻译已取消，需要时重新发送。 |

**单次翻译请求的超时时间为 30 秒（30s），超时也会导致翻译失败。** 简短的连接测试成功，也不能排除长文本翻译超时；可先[测试翻译速度](#测试翻译速度)，了解当前服务和模型的响应情况。遇到超时可重试，或换用响应更快的翻译模型。

| 失败发生在哪里 | 消息状态 | 接下来怎么做 |
| --- | --- | --- |
| 发送普通中文提示词时 | 本次提示词未发送给 Claude。 | 修正设置后重新发送，或重试。 |
| 在 `AskUserQuestion` 中自行输入回答时 | 该回答未提交；Claude 会收到失败通知，并被要求重新提问。 | 修正设置后，在重新出现的提问中作答。 |
| 阅读中文译文时 | 原文仍可阅读；Claude 已生成的回答不受影响。 | 点击 **Retry translation（重试翻译）**。 |

如果决定暂时关闭翻译，**关闭后重新发送的中文会原样提交给 Claude**，后续开启翻译也不会补译这次输入。

## 输入翻译范围

> **Claude 仍可能收到中文。** 斜杠命令及其中的中文参数不会被翻译。保留文本、已有历史记录、文件和其他上下文中的中文也不在输入翻译范围内。屏幕上显示中文消息，并不代表 Claude 收到的也是中文。

### 提交前会翻译的输入

在受支持的交互式会话中，翻译处于 **On（开启）** 状态时：

| 输入内容 | Claude 收到的内容 |
| --- | --- |
| 普通中文提示词 | 自然语言部分的英文译文，下文列出的保留内容维持原样。 |
| 在 `AskUserQuestion` 对话框中自行输入的中文回答 | 输入文本的英文译文。如果同时选择了选项，选项的原始值保持不变。 |

如果输入中除保留文本外没有中文自然语言内容，则直接按原样提交，不发起翻译请求。

需要翻译的输入会经过[发送前的翻译检查](#发送前的翻译检查)；检查针对译文，按规则保留的中文不计入中文残留检查。

### 不会翻译的输入

| 输入内容 | 处理方式与影响 |
| --- | --- |
| **斜杠命令及其参数** | **整条命令保持原样**，包括内置命令、自定义技能和插件命令中的自然语言参数。如果命令将这些参数转交给 Claude，其中的中文也会原样传递。 |
| `!` Shell 命令 | 命令及其参数保持原样。命令或其输出中的中文在成为会话上下文前不会被翻译。 |
| `AskUserQuestion` 对话框中选中的选项 | 提交选项的原始值。即使该对话框中的其他文本已翻译显示，中文选项值仍然是中文。 |
| 翻译处于 **Off（关闭）** 状态时的输入 | 按原样提交，包括中文提示词和在 `AskUserQuestion` 中自行输入的回答。 |
| 自动提交的提示词 | 提示词若来自插件、通知、无界面 CLI 运行或独立 SDK 自动化，就不在输入翻译范围内。支持 Desktop 中的交互式提交。 |
| 其他输入框和对话框 | 上述自由文本翻译适用于 `AskUserQuestion`，并不覆盖所有文本输入框或权限对话框。 |

例如，`/statusline 加入 sessionID` 会按输入原样提交。要用英文发送这条指令，需要自行输入 `/statusline Add sessionID`。只要输入的第一个非空白字符是 `/` 或 `!`，就会绕过翻译，即使它没有被识别为有效命令。

### 翻译时保持原样的文本

以下内容在被识别后会逐字保留，包括其中的中文：

- 行内代码和围栏代码块，包括其中的注释和字符串值。
- URL、Markdown 链接及其显示文字、文件引用、`@` 提及和路径。
- 常见的 LaTeX 公式。
- 引号字符串，但要求消息中该引号片段之外还有非空白内容。如果去掉首尾空白后，整条消息恰好就是该引号片段，则按自然语言文本处理。这一判断不设字数或长度阈值。
- 被 Claude Code 标记为粘贴块的内容。普通纯文本粘贴与手动输入的文本采用相同处理方式。

例如，在 `将按钮文字改为“提交”` 中，指令会被翻译，但 `“提交”` 会被保留，并以中文形式传给 Claude。即使翻译成功，这些保留部分仍可能因此包含中文。

为符合目标语言的语法，保留的行内文本可以在原所在行或表格单元格内调整顺序。表格和正文的排版也取决于翻译模型。可通过 **View original（查看原文）** 和 **View sent text（查看已发送文本）** 核对措辞与格式。

### 其他上下文不会转为英文

启用本 Mod 不会改写已有会话历史。Claude 读取的文件、`CLAUDE.md` 等项目指令、展开后的技能内容、普通工具结果，以及图片或文档附件，都不会由本 Mod 翻译成英文。其中的中文仍可能被 Claude 读取。仅用于显示的消息翻译不会移除会话中已有的中文。

## 中文显示范围

显示译文不会替换模型的会话历史，也不会改变 Claude 的原始回答。本 Mod 不强制 Claude 使用某种语言回复；如果 Claude 生成了中文回答，它在会话中仍然是中文。

| 内容 | 显示方式 |
| --- | --- |
| 新翻译的用户提示词 | 通常显示你输入的中文原文。**View sent text（查看已发送文本）** 可显示实际提交的版本。 |
| 较早的用户消息 | 如果有已保存的中文，则优先使用。否则，浏览到受支持的英文消息时，会生成用于显示的中文译文；会话历史保持不变。 |
| 主会话中的最终回答 | 自然语言部分含英文且不含中文时，会生成用于显示的中文译文。**View original（查看原文）** 可显示 Claude 的原始回答。 |
| `AskUserQuestion` 对话框及其显示结果 | 问题和选项描述可显示中文译文。选项标签保留原始值，标签的译文显示在描述中。自行输入并经过翻译的回答会保留中文原文用于显示。 |
| 思考过程、中间回复、普通工具调用及结果、命令输出和子代理消息 | 保持原样。 |

用户消息和最终回答优先显示已保存的中文。如果没有已保存的中文，且自然语言部分已含中文，则直接显示，包括中英混合消息；其余英文不会自动翻译。语言检查不包含保留文本。`AskUserQuestion` 对话框中的英文字段则可以单独翻译，即使其他字段已经包含中文。

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

这项检查只覆盖需要翻译的输入。命令参数、保留文本、`AskUserQuestion` 中选中的选项，以及已有历史、文件等上下文，仍可能包含中文。关闭翻译时，中文输入也会原样提交。完整规则见[输入翻译范围](#输入翻译范围)。

绕过翻译的输入不会显示翻译失败提示；已翻译的普通提示词可用 **View sent text（查看已发送文本）** 核对。

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

启动新的 Claude Code 会话。Mod 会从该目录自动加载，无需注册到插件市场。看到输入框上方的 **Bilingual View** 设置栏后，按[配置](#配置)填写翻译服务，即可开始使用。

## 更新与卸载

### Marketplace 方式

更新市场目录并更新插件：

```sh
claude plugin marketplace update bilingual-view
claude plugin update bilingual-view@bilingual-view
```

本项目按 Git 提交提供更新。更新后启动新会话，或在已打开的终端会话中运行 `/reload-plugins`。

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
| `/bilingual-view speed` | 将内置英文长文本一次性译为中文，并报告用时或失败原因。 |
| `/bilingual-view diagnostics` | 导出用于问题反馈的近期诊断信息，覆盖上次导出；不发起网络请求。 |

上表中的命令用于控制本 Mod。其他命令的翻译行为见[不会翻译的输入](#不会翻译的输入)。
