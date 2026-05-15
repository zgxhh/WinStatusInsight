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
提交代码
推送 main
创建或更新 vX.Y.Z Release
上传更新三件套
```

## 3. GitHub Release 更新三件套

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

## 4. electron-updater 机制

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

## 5. 安装包路线

WinStatusInsight 当前只维护安装版作为正式下载入口，不再把便携版作为正式发布路线。

正式下载链接应指向安装包：

```text
https://github.com/zgxhh/WinStatusInsight/releases/latest/download/WinStatusInsight-Setup-<version>.exe
```

README 不要再主推便携版。若用户提到免安装/便携版，先确认是临时开发测试还是正式发布需求。

## 6. 代码签名

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

## 7. 本地端口与进程

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

## 8. 系统操作安全边界

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

## 9. 磁盘迁移规则

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

## 10. UI 与验收

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

## 11. 截图与 README

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

## 12. 构建验证

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

## 13. 已知无害警告

以下警告已多次出现，不影响当前运行：

```text
Some chunks are larger than 500 kB
@vueuse/core PURE annotation comment warning
```

除非用户明确要求优化包体，否则不要因为这些警告中断任务。

## 14. 编码与中文

历史上 README 和部分输出曾出现中文乱码。后续编辑用户可见文档、README、项目记忆和 UI 文案时，应确保是正常 UTF-8。

不要把终端里的乱码原样写入用户可见 UI。
