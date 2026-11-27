# Ubi Bureau

[English](README.md) · [Русский](README.ru.md) · **中文**

**在同一个像素工作室里观察你的编程智能体。**

[下载 Linux AppImage](https://github.com/romantrnt/ubi-bureau/releases/latest) · [连接指南](docs/CONNECTIONS.md) · [构建](docs/BUILD.md) · [隐私](docs/PRIVACY.md)

![使用模拟会话的像素工作室](docs/assets/overview.png)

0.4 重新设计了像素场景、角色和界面。应用默认使用英语。场景旁边是可搜索的会话列表、历史记录与遥测。场景是真正的三维体素空间，支持旋转视角与轮廓线，需要 WebGL。

工作中、等待答复和未知状态明确区分；每个状态都有来源与观察时间。新日志不等于进程仍然存活，超过 120 秒的非终止状态变为未知。已完成会话留在历史记录中，不占据场景。暂停装饰动画不会暂停数据更新。

**Connections** 展示来源是否可用及配置说明。适配器支持 Claude Code、Codex、Gemini CLI、Antigravity CLI、Hermes、DeepSeek Harness、OpenCode、Copilot CLI、Kimi Code、Grok Build、OMP 和 Pi 的本地存储。Antigravity App、IDE 与 CLI 分别读取其文档定义的 transcript；安装了 IDE 但没有可读 transcript 时不视为已连接。请查看[实际支持范围](docs/CONNECTIONS.md)。

Dot 是一个三层服务器角色。云端快照不会被当作实时工作人员；没有可靠实时来源时，活跃子智能体数量不可用。

```sh
chmod +x Ubi_Bureau-0.4.0-x86_64.AppImage
./Ubi_Bureau-0.4.0-x86_64.AppImage --check
./Ubi_Bureau-0.4.0-x86_64.AppImage --demo
# 关闭演示后，正常启动以读取本地会话：
./Ubi_Bureau-0.4.0-x86_64.AppImage
```

平台为 Linux x86_64/glibc。Node.js 已打包，但系统需要 **Python 3、PyGObject、GTK4 和 WebKitGTK 6.0**。没有 FUSE 时使用 `--appimage-extract-and-run`。

点击角色打开会话；拖动旋转，滚轮缩放。`Ctrl K` 搜索，`F` 定位角色，`N` 查看需要答复的会话，`B` 切换列表，`M` 暂停装饰动画，`?` 显示快捷键。

签名 AppImage 更新保留原有发行身份及独立备份；安装需要确认，不自动重启。会话存储在本地只读访问，不上传对话。不要通过隧道暴露本地服务器。`--private` 隐藏文字和标题，但不能匿名化全部元数据。

[验证与限制](docs/TESTING.md) · [更新](docs/UPDATES.md) · [完整英文文档](README.md)

本项目衍生自 [whatsmyagentdoing](https://github.com/Charonyuu/whatsmyagentdoing)，保留其 [MIT 署名](LICENSE)。0.4 默认像素场景和界面为 Ubi Bureau 编写。[第三方组件](THIRD-PARTY-NOTICES.md) 保留各自许可证。
