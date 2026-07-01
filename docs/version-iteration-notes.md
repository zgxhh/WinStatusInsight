# WinStatusInsight 版本迭代后续开发注意事项

本文档用于记录 WinStatusInsight 后续开发和发布时需要避免的坑。每次在开发、打包、发布、更新、UI 验收或系统操作中发现新的风险点，都要同步更新本文档。

## 1. 项目路径与当前状态

真实项目路径：

```text
D:\HuaweiMoveData\Users\HUAWEI\Desktop\WinStatusInsight
```

不要再使用旧路径作为主项目：

```text
C:\Users\HUAWEI\Desktop\WinStatusInsight
```

继续开发前先检查：

```powershell
git status --short --branch
```

当前可能存在本地未提交改动。不要直接 `git reset --hard`、`git checkout --` 或覆盖用户/前序会话改动。

## 2. 发布与版本号

正式给别人使用或让应用内更新生效时，必须升版本号，例如：

```text
2.1.0 -> 2.1.1
```

不要把同一个版本号的 Release 反复覆盖当作常规更新方式。覆盖同版本适合“刚发布发现包错了”的修正，不适合已安装用户的正常更新，因为应用无法通过版本比较发现新版。

发布给外部使用时，流程应包含：

```text
升 package.json version
npm run package:win:installer
验证 release\win-unpacked\WinStatusInsight.exe 可启动
提交代码
推送 main
创建或更新 vX.Y.Z Release
上传更新三件套
从 GitHub 最新下载链接安装到本机
启动已安装版并验收
反查 latest Release、latest.yml、安装包下载链接
清理测试进程和本地开发端口
```

## 3. 发布后本机安装验收

正式发布完成后，不能只以“打包成功”或“`release\win-unpacked` 能启动”作为完成标准。每次 GitHub Release 发完，都必须从 GitHub 最新下载链接安装到本机电脑，并启动安装版验收。

验收入口必须使用：

```text
https://github.com/zgxhh/WinStatusInsight/releases/latest/download/WinStatusInsight-Setup-<version>.exe
```

不要只使用本地 `release\WinStatusInsight-Setup-<version>.exe` 代替最终验收，因为真实用户走的是 GitHub Release 下载链路。

发布后安装验收清单：

```text
GitHub latest Release 版本与 package.json 一致
Release 资产包含 exe、blockmap、latest.yml
latest.yml 内 version 与安装包文件名正确
从 GitHub latest 下载安装包并安装到本机
启动已安装版 WinStatusInsight.exe
确认没有主进程 JavaScript Error 弹窗
确认窗口能正常显示主界面
确认内置服务能启动
确认设置里的“检查版本更新”走桌面应用接口，不误判为浏览器环境
```

验收通过前，不要把该版本当作真正完成，也不要在最终回复里只写“打包成功”。最终回复必须明确写出“本机安装验收结果”。

如果安装版打不开或更新检查异常：

```text
记录错误原文或截图
定位并修复
升补丁版本，例如 2.1.1 -> 2.1.2
重新构建、提交、推送、发布
重新从 GitHub latest 下载安装并验收
把踩坑点写入本文档和 session-memory.md
```

不要把同版本 Release 覆盖当作常规修复；坏版本如果主进程无法启动，应用内更新无法自救，必须手动安装修复版一次。

## UI 图表验收

- 紧凑 ECharts 环图不要依赖 `title` 在圆心内承载关键数值；不同容器尺寸和重新计算时可能出现位置不稳定。关键值应使用独立文本层，图表只负责数据图形。
- 中控台改版必须同时检查参考图同尺寸桌面视口和窄屏视口，并确认控制台无错误、图表标签不重叠、按钮文字不截断。

## 本地项目状态判断

- 绑定项目模块不能只按端口是否处于 `LISTEN` 判断为“运行中”；macOS 上可能出现进程只监听 `[::1]` 或端口被占但 `127.0.0.1:<port>` 实际打不开的情况。
- 展示“运行中”和访问地址前，必须同时满足：监听进程能归属到该模块，且本机 HTTP 地址可访问。端口有监听但本机地址不可访问时，应显示为异常并隐藏不可点击地址。
- 面板启动本地项目时要保持类似 VSCode 终端的后台运行体验：子进程应 `detached + unref`，stdout/stderr 直接写入日志文件句柄，不要依赖父进程 pipe，否则面板后端重启或退出后进程持久性和日志稳定性会变差。

## 4. GitHub Release 更新三件套

应用内更新使用 `electron-updater`，正式 Release 必须同时上传：

```text
WinStatusInsight-Setup-<version>.exe
WinStatusInsight-Setup-<version>.exe.blockmap
latest.yml
```

三者作用：

- `.exe`：NSIS 安装包。
- `.blockmap`：差量更新所需文件。
- `latest.yml`：`electron-updater` 判断最新版本、下载地址和校验信息的入口。

只上传 `.exe` 时，浏览器下载仍可用，但应用内更新不可用或无法差量更新。

## 5. electron-updater 机制

当前产品定义的更新体验：

```text
用户手动点“检查版本更新”
发现新版
用户手动点“下载并自动安装”
electron-updater 下载更新
下载完成自动退出、安装、重启
用户不需要手动双击安装包
```

关键约束：

- 不做启动自动检查更新。
- 不在用户未授权时自动下载更新。
- 用户点击“下载并自动安装”即视为授权。
- 下载完成后调用：

```js
autoUpdater.quitAndInstall(false, true)
```

开发环境下更新检查应提示“仅安装版可用”，不要让 `npm run dev` 直接触发 GitHub 更新流程。

### electron-updater 导入方式

当前项目是 ESM 主进程，`electron-updater` 是 CommonJS 包，不能写成：

```js
import { autoUpdater } from 'electron-updater'
```

安装版会在主进程启动时报：

```text
Named export 'autoUpdater' not found
```

正确写法：

```js
import updater from 'electron-updater'

const { autoUpdater } = updater
```

每次改动 Electron 主进程依赖后，必须启动 `release\win-unpacked\WinStatusInsight.exe` 做一次真实桌面包冒烟验证，不能只跑 `npm run dev`。

### 2.1.1 启动崩溃踩坑

`2.1.1` 曾因 `electron-updater` CommonJS/ESM 导入方式错误导致安装版主进程崩溃。坏版本启动时报：

```text
Named export 'autoUpdater' not found
```

这类主进程启动崩溃会导致用户无法打开应用，也就无法通过应用内更新自救。必须升补丁版本重新发布，并让用户手动安装修复版一次。

以后只要改动 Electron 主进程依赖、`electron/main.js`、`electron/preload.js` 或打包配置，发布后必须做 GitHub 下载包本机安装验收，不能只验证开发环境或 `win-unpacked`。

### 2.1.2 preload 桥接缺失踩坑

`2.1.2` 安装版可以启动，但 GitHub 下载包本机安装验收时发现窗口内 `window.winStatusInsight` 为 `false`，导致设置里的检查更新无法走 Electron 桌面接口。

原因是 preload 文件使用 ESM 写法：

```js
import { contextBridge, ipcRenderer } from 'electron'
```

在当前打包后的 Electron preload 环境里不稳定。preload 必须使用 CommonJS `.cjs` 文件：

```js
const { contextBridge, ipcRenderer } = require('electron')
```

并且 `BrowserWindow.webPreferences.preload` 必须指向：

```text
electron/preload.cjs
```

发布后安装验收必须通过调试端口或等效方式确认：

```js
!!window.winStatusInsight === true
```

## 6. 安装包路线

WinStatusInsight 当前只维护安装版作为正式下载入口，不再把便携版作为正式发布路线。

正式下载链接应指向安装包：

```text
https://github.com/zgxhh/WinStatusInsight/releases/latest/download/WinStatusInsight-Setup-<version>.exe
```

README 不要再主推便携版。若用户提到免安装/便携版，先确认是临时开发测试还是正式发布需求。

## 7. 代码签名

当前未正式接入证书签名。不签名也能运行和更新，但可能出现：

```text
Windows SmartScreen 提示
安全软件提示
静默安装体验不稳定
用户信任感不足
```

以后接入签名时，需要重新处理 `package.json` 中的：

```json
"signAndEditExecutable": false
```

正式签名时通常需要删除它或改为允许签名，并配置：

```powershell
$env:CSC_LINK="证书路径或 base64"
$env:CSC_KEY_PASSWORD="证书密码"
```

## 8. 本地端口与进程

开发端口：

```text
5273 前端 Vite
5274 后端 Express
```

停止本地开发服务时，只停止监听这两个端口的进程，不要乱杀所有 `node.exe`：

```powershell
Get-NetTCPConnection -LocalPort 5273,5274 -State Listen
Stop-Process -Id <PID> -Force
```

绑定项目的运行状态和停止操作必须使用同一套进程归属判断。不能只用“端口正在监听”显示运行中、却只依赖服务内存里的启动 PID 执行停止；后端重启后内存记录会丢失，形成“运行中但提示没有运行”的矛盾。

在 macOS 开发环境中，需结合监听端口、进程命令、进程工作目录和进程组找回绑定模块。停止外部遗留进程前必须确认其工作目录属于绑定模块，不能仅凭端口号结束进程。

## 9. 系统操作安全边界

可执行的低风险操作：

```text
Temp 中超过 24 小时且未占用的文件
旧 Electron 解压残留
回收站清空
开发缓存迁移到 D:\MovedFromC 并创建 Junction
当前用户自启动项开关
可停止的本地开发项目
```

不可直接删除、迁移或停止的对象：

```text
Chrome 本地模型
Codex 数据
微信、剪映、抖音、微信开发者工具
系统目录
Program Files
Windows
用户文档、图片、视频
系统进程
PID 0 / Idle / System
当前 WinStatusInsight 面板进程
```

停止项目接口不要把 PowerShell 原始错误或乱码堆栈展示给用户，应返回中文摘要，例如：

```text
已停止 X 个，跳过 Y 个受保护进程
```

## 10. 磁盘迁移规则

开发缓存迁移目标固定：

```text
D:\MovedFromC\Users\HUAWEI\...
```

迁移流程固定：

```text
robocopy 到 D 盘
原目录改名备份
创建 Junction
校验 Junction 和目标大小
成功后删除备份
失败时保留备份并提示
```

不要直接硬删 `D:\MovedFromC`，否则 Junction 指向的数据会丢失。

## 11. UI 与验收

用户经常通过浏览器截图标注 UI 问题。若用户点名 `ui界面美化员`，必须读取并使用：

```text
C:\Users\HUAWEI\.codex\skills\ui-polisher\SKILL.md
```

如果用户要求“先出调整图片不改代码”，必须只生成效果图，不修改源码。

当前确认过的 UI 方向：

- 深色科技风。
- 不要白底后台表格感。
- 不要直接使用 Element Plus 默认观感。
- 表盘、按钮要有科技感，但不能杂乱。

当前表盘方向：

- 参考生成图 A。
- 青绿色外侧能量弧。
- 内侧密刻度。
- 数字刻度 `0 / 20 / 40 / 60 / 80 / 100`。
- 中央大评分。
- 中文状态：`流畅 / 良好 / 关注 / 卡顿 / 读取中`。
- 不要 `SCORE`。
- 不要 `/100`。

当前“读取状态”按钮方向：

- 参考生成图第 5 个。
- 左侧独立图标舱。
- 中间分隔线。
- 右侧文字。
- 末端推进点。
- 斜切科技边框。

首屏布局注意：

- 不要让评分卡和趋势图底部留巨大空白。
- 表盘时间要贴近表盘。
- 趋势图绘图区要吃满高度。
- 右侧瓶颈列表应卡内滚动，避免撑高整行。

## 12. 截图与 README

前端有明显 UI 变化后，需要重新截图并更新 README。

README 截图路径：

```text
docs/assets
```

常用截图输出路径：

```text
output/playwright
```

Playwright 可使用本地 Codex runtime：

```powershell
$env:NODE_PATH='C:\Users\HUAWEI\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
```

## 13. 构建验证

常用验证命令：

```powershell
node --check electron\main.js
npm run build
npm run package:win:installer
```

打包后冒烟测试：

```powershell
Start-Process release\win-unpacked\WinStatusInsight.exe
```

验证后关闭残留进程：

```powershell
Get-Process WinStatusInsight
Stop-Process -Id <PID> -Force
```

## 14. 已知无害警告

以下警告已多次出现，不影响当前运行：

```text
Some chunks are larger than 500 kB
@vueuse/core PURE annotation comment warning
```

除非用户明确要求优化包体，否则不要因为这些警告中断任务。

## 15. 编码与中文

历史上 README 和部分输出曾出现中文乱码。后续编辑用户可见文档、README、项目记忆和 UI 文案时，应确保是正常 UTF-8。

不要把终端里的乱码原样写入用户可见 UI。

## 16. AI 本地项目诊断边界

- AI 只读取脱敏后的启动日志和项目元数据，不上传 `.env`、凭证文件或源码全文。
- AI 只能诊断并推荐环境、依赖和已有启动命令，不能修改源码、配置文件或 `package.json`。
- 修复命令必须由用户确认，并同时通过后端白名单与本次诊断结果校验；诊断结果 30 分钟后失效。
- 允许命令仅限依赖安装、`.NET restore/build/run` 和已有的 `npm run dev/start`，禁止删除、移动、全局安装、提权、管道脚本、Git 重置及系统环境修改。
- API Key 仅保存到本机 `data/ai-settings.json`，接口只返回掩码，文件必须保持在 `.gitignore` 中。

## 17. 本地项目模块表格高度

- “已绑定项目”里的模块表格是卡片内嵌 Element Plus 表格，新增操作列或固定列后必须检查多模块项目。
- 不要让 `.binding-card` 裁切表格内容；模块表格需要按模块数量撑开自然高度。
- 验收时至少检查一个 3 个模块的绑定项目，确认每一行状态、地址和操作按钮都可见、可点击。
