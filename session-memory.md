# WinStatusInsight 项目记忆

## 桌面更新机制

- WinStatusInsight 采用安装版路线，不再维护便携版作为正式下载入口。
- 正常对外更新必须升版本号，例如 `2.1.0 -> 2.1.1`；不要只覆盖同版本 Release 当作常规更新，否则已安装用户无法通过版本比较发现新版。
- 应用内更新采用 `electron-updater`，触发方式是用户手动点击设置里的“检查版本更新”，不在启动时自动联网。
- 更新体验定义为：用户手动点击“下载并自动安装”即视为授权；下载完成后应用自动调用 `quitAndInstall(false, true)`，退出、安装并重启，不要求用户手动双击安装包。
- `electron-updater` 会优先基于 blockmap 做差量下载；差量失败时由 updater 回退完整下载。

## Release 注意事项

每次正式发布给别人/下载链接使用时，GitHub Release 必须上传：

```text
WinStatusInsight-Setup-<version>.exe
WinStatusInsight-Setup-<version>.exe.blockmap
latest.yml
```

其中：

- `.exe` 是 NSIS 安装包。
- `.blockmap` 用于差量更新。
- `latest.yml` 是 `electron-updater` 判断最新版本、下载地址和校验信息的入口。

只上传安装包会导致 GitHub 下载可用，但应用内更新不可用或无法差量更新。

## 发布后本机安装验收

- 每次正式发布完成后，必须从 GitHub Release 最新下载链接下载并安装到本机电脑，不能只验证本地 `release\win-unpacked`。
- 安装后必须启动已安装版 `WinStatusInsight.exe`，确认没有主进程 JavaScript Error，窗口能正常打开，内置服务能启动。
- 设置里的“检查版本更新”必须在桌面应用中走 Electron 接口，不能误判为“版本更新只在桌面应用中可用”。
- 验收通过前，不把该版本当作真正完成；最终回复必须明确写出“本机安装验收结果”。
- 如果安装版打不开或更新异常，记录错误原文或截图，升补丁版本继续修复并重新发布，不要把覆盖同版本 Release 当作常规修复。
- 坏版本如果主进程无法启动，应用内更新无法自救，需要用户手动安装修复版一次。

## 适合的发布节奏

- 本地开发预览：不需要提交、推送、打包或发布。
- 自己安装使用：需要重新打包并本机安装，不一定需要发布 GitHub。
- 给别人使用或让下载链接/应用内更新生效：需要升版本、提交、推送、打包，更新 GitHub Release 三件套，并从 GitHub latest 下载包安装到本机验收。

## 已记录踩坑

- `2.1.1` 曾因 `electron-updater` CommonJS/ESM 导入方式错误导致安装版主进程崩溃，错误为 `Named export 'autoUpdater' not found`。
- 修复方式是使用默认导入再解构：`import updater from 'electron-updater'; const { autoUpdater } = updater`。
- 以后改动 Electron 主进程依赖、`electron/main.js`、`electron/preload.js` 或打包配置后，必须做 GitHub 下载包本机安装验收。

## 踩坑点沉淀规则

- 项目已新增版本迭代注意事项文档：`docs/version-iteration-notes.md`。
- 后续每次发现新的开发、打包、发布、更新、UI 验收、系统操作或用户体验踩坑点，都必须同步更新 `docs/version-iteration-notes.md`。
- 新窗口继续开发时，应先阅读 `docs/version-iteration-notes.md` 和本文件，避免重复踩坑。
