# AIstudy Vocabulary Capture Android

这是 AIstudy 词汇采集的 Android 伴随 APK 工程。APK 通过 Accessibility Service 读取百词斩当前词卡上的可访问性文本，并实时发送到桌面端 AIstudy 的 `38673` 接收端口。

## Build

```powershell
$env:GRADLE_USER_HOME='F:\AIAPP\Codex\gradle-home'
gradle --no-daemon :app:assembleDebug
```

构建产物：

```text
app/build/outputs/apk/debug/app-debug.apk
```

仓库内固定发布副本：

```text
dist/AIstudyVocabularyCapture-0.1.4-debug.apk
```

## Runtime

- 包名：`com.aistudy.vocabularycapture`
- 当前版本：`0.1.4`，`versionCode=5`
- 权限入口：系统无障碍设置
- 目标桌面端：AIstudy 主进程词汇采集服务
- 端口：`38673`

用户安装后需要在系统无障碍设置中开启“AIstudy词汇采集”。多数 Android 环境会记住授权；如果宿主模拟器或系统强制回收无障碍授权，则需要用户重新确认。

## Data Rules

APK 不保存词汇数据。它只做实时采集和发送；筛选、去重、文档合并和 MySQL 持久化全部由桌面端 `electron/vocabularyCaptureService.ts` 负责。
