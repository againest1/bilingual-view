<div align="center">

# Bilingual View

**中文输入，中文阅读，随时核对原文。**

Claude Code 的双语 Mod。让普通中文提示词以英文提交，<br>
让符合翻译条件的英文最终回答以中文显示。

[快速开始](#快速开始) · [日常使用](#日常使用) · [常见问题](#常见问题) · [完整指南](USAGE.md)

</div>

![翻译流程示意：你输入「解释这段代码」，Claude 收到「Explain this code.」；Claude 回答「This function reads the config.」，你看到「这个函数会读取配置。」](assets/translation-flow.svg)

<p align="center"><sub>纯自然语言的翻译示例，实际措辞由你选择的翻译模型决定。</sub></p>

- **用中文交流**：翻译普通提示词和提问对话框中自行输入的回答；支持的英文消息可显示中文译文。
- **随时对照原文**：查看提示词实际发送的版本，或切回 Claude 的原始回答。
- **自选翻译服务**：使用兼容 OpenAI Chat Completions 接口的服务，不改变 Claude 会话使用的模型。

> 翻译有明确的[适用范围](#翻译范围)：命令参数、保留文本和其他会话上下文仍可能包含中文。

## 快速开始

你需要一个**支持 Mods 的 Claude Code 交互式终端或 Desktop 会话**，以及可用的翻译服务、模型和 API 密钥（如需）。无需单独安装 Node.js、执行构建或启动辅助服务。

### 1 · 安装插件

在系统终端运行：

```sh
claude plugin marketplace add againest1/bilingual-view
claude plugin install bilingual-view@bilingual-view
```

启动新的 Claude Code 会话；已打开的终端会话也可以运行 `/reload-plugins`。输入框上方出现 **Bilingual View** 设置栏，即可继续配置。

也可以[手动安装](USAGE.md#手动安装)。

### 2 · 配置翻译服务

点击 **Settings（设置）**，或运行 `/bilingual-view settings`：

| 设置项 | 填写内容 |
| --- | --- |
| **Provider URL** | 服务的 API 基础地址，例如 `https://provider.example/v1`。也支持完整的 `/chat/completions` 地址，不要填写 `/models` 地址。 |
| **API key** | 输入密钥并按 **Enter** 保存，成功后立即生效；服务无需身份验证时可不填。 |
| **Model ID** | 输入翻译模型标识，或点击 **Fetch models** 从列表选择。 |

需要翻译的文本会发送到这个服务。模型列表不可用时，可直接填写 Model ID。

API key 由 Claude 保存；输入时可见，保存后只显示是否已设置。更多说明见[配置指南](USAGE.md#配置)。

### 3 · 开始使用

点击 **Test connection（测试连接）**，确认示例翻译成功。该请求发送到你配置的翻译服务，不会成为 Claude 会话中的消息。

翻译默认开启。确认设置栏为 **On** 后，像平常一样输入中文提示词：翻译成功并通过检查后，英文译文会提交给 Claude，界面保留你的中文原文供你阅读。

## 日常使用

| 你想做什么 | 操作 |
| --- | --- |
| 核对提示词实际发送的内容 | 在已翻译的用户消息旁或下方点击 **View sent text（查看已发送文本）**。 |
| 查看 Claude 的原始回答 | 在已翻译的最终回答下方点击 **View original（查看原文）**。 |
| 切换回中文 | 点击 **Show Chinese（显示中文）**。 |
| 暂停或恢复翻译 | 点击设置栏的 **On/Off**，或运行 `/bilingual-view off` / `/bilingual-view on`。 |
| 检查设置与连接 | `/bilingual-view status` 查看设置；`/bilingual-view check` 发送示例翻译请求。 |

**关闭翻译后，输入会按原样提交，消息也会显示原文。** 重新开启不会补译已经发送给 Claude 的中文。查看已发送文本是在提交之后，提交前没有译文预览。

## 翻译范围

| 内容 | 会发生什么 |
| --- | --- |
| 普通中文提示词、`AskUserQuestion` 中自行输入的中文回答 | 开启翻译时，自然语言部分先译为英文再提交。 |
| 支持的英文用户消息、主会话中的英文最终回答 | 可生成中文译文用于显示；已有中文的自然语言文本（包括中英混合消息）直接显示。 |
| `AskUserQuestion` 的问题和选项描述 | 可显示中文译文；选项标签保留原始值，标签的译文显示在描述中。 |
| `/` 斜杠命令及参数、`!` Shell 命令、选中的选项 | 原样提交，其中的中文不会被翻译。 |
| 代码、路径、链接、符合保留规则的引号文本等 | 翻译时保持原样，包括其中的中文。 |
| 已有会话历史、文件、项目指令、工具结果及附件 | 不会被改写为英文。思考过程、中间回复和子代理消息也不翻译显示。 |

例如，`/statusline 加入 sessionID` 会原样提交；`将按钮文字改为“提交”` 会翻译指令，但保留 `“提交”`。

对需要翻译的输入，**未配置服务、翻译失败或译文中仍残留本应翻译的中文，都会阻止提交**。绕过翻译的输入不受这些检查限制。显示译文不会改写会话历史，也不强制 Claude 用英文回答。

完整的输入来源、文本保留和显示规则见[输入翻译范围](USAGE.md#输入翻译范围)与[中文显示范围](USAGE.md#中文显示范围)。

## 常见问题

<details>
<summary><strong>安装后看不到设置栏？</strong></summary>

先确认 Claude 宿主支持 Mods。在 `/plugin` → **Installed** 中确认 `bilingual-view@bilingual-view` 已安装并启用，再启动新会话，或在终端会话中运行 `/reload-plugins`。手动安装请核对[安装目录](USAGE.md#手动安装)。

</details>

<details>
<summary><strong>翻译失败，或模型列表返回 404？</strong></summary>

用 `/bilingual-view check` 检查 URL、密钥和模型。Provider URL 应包含服务要求的 API 路径前缀；服务没有模型列表接口时，直接填写 Model ID。

输入翻译失败时不会提交。显示翻译失败时仍可阅读原文，并点击 **Retry translation（重试翻译）**。详见[失败处理](USAGE.md#翻译失败时的处理)。

</details>

<details>
<summary><strong>为什么 Claude 仍收到了中文，或部分回答没有翻译？</strong></summary>

翻译覆盖的是特定输入和显示内容。命令、保留文本及其他上下文可能含中文；中英混合的自然语言消息、思考过程和普通工具结果不会自动翻译。可用 **View sent text** 核对已翻译提示词实际提交的版本，再对照[翻译范围](#翻译范围)。

</details>

<details>
<summary><strong>中文原文和译文保存在哪里？</strong></summary>

保存在本机的 `~/.claude/bilingual-view/cache/`，与 Claude 会话历史分开。每个会话最多 4 MiB，达到上限时较早的记录可能被移除。更新和卸载插件都不会主动清除缓存。

删除缓存会丢失已保存的中文原文；重新翻译无法还原最初的准确措辞。同一会话请勿同时在多个 Claude Code 实例中使用。详见[数据与翻译缓存](USAGE.md#数据与翻译缓存)。

</details>

## 更多说明

[完整使用指南](USAGE.md) · [更新与卸载](USAGE.md#更新与卸载) · [清理翻译缓存](USAGE.md#清理翻译缓存) · [全部命令](USAGE.md#bilingual-view-命令)

## 许可证

本项目采用 [MIT License](LICENSE)。
