# Java 版构建说明

> 构建环境说明：以下命令为仓内历史构建命令整理，步骤 1 的桩源码已入仓（java/stubs/，见下文）。
> 本轮改动未在有 Android SDK 的环境中完整复现：实测过的平台与 JDK 版本待首次完整复现时在此补记，
> 在此之前请勿将本文件所列版本理解为已实测。本次不重建 spider.jar（见 README 与 PR 说明）。

```bash
# 以下命令均在 java/ 目录下执行
# 1) 编译桩（仅编译期，不打进 jar；桩源码见 java/stubs/com/github/catvod/crawler/Spider.java）
javac -source 8 -target 8 -classpath "$ANDROID_HOME/platforms/android-36/android.jar" \
      -d stubs stubs/com/github/catvod/crawler/Spider.java

# 2) 编译爬虫
# Unix（Linux / macOS）：classpath 分隔符为冒号 :
javac -source 8 -target 8 -encoding UTF-8 \
      -classpath "$ANDROID_HOME/platforms/android-36/android.jar:stubs" \
      -d out src/Kanju.java src/Proxy.java
# Windows PowerShell：classpath 分隔符为分号 ;，其余命令相同
# javac -source 8 -target 8 -encoding UTF-8 `
#       -classpath "$env:ANDROID_HOME/platforms/android-36/android.jar;stubs" `
#       -d out src/Kanju.java src/Proxy.java

# 3) 转 dex（Android 只能加载 dex）
d8 --release --min-api 23 \
   --lib "$ANDROID_HOME/platforms/android-36/android.jar" --lib stubs \
   --output dexout $(find out -name '*.class')

# 4) 打包与校验：并行生成 MD5（过渡保留）与 SHA-256；发布时附 SHA-256 值
jar cf spider.jar -C dexout classes.dex
md5sum spider.jar > spider.jar.md5
sha256sum spider.jar > spider.jar.sha256
sha256sum -c spider.jar.sha256
```

要点：

- App 要求 jar 内是 `classes.dex`（不是 `.class`），否则 `Failed to open dex files`；
- 必须包含 `com.github.catvod.spider.Proxy`，否则加载器 `ClassNotFoundException` 导致爬虫为 null；
- 签名密钥运行时从站点 bundle 提取，换构建不需要重打包。
- 步骤 2 的路径已按仓内实际布局修正：源码在 java/src/ 下（Kanju.java、Proxy.java），不是包路径目录；步骤 1 的桩源码在 java/stubs/ 下。
- 本次不重建 jar：仓内现有的 spider.jar 与 spider.jar.md5 是硬化前旧构建的配对，未随本次源码改动重新生成；下次发布时按步骤 4 生成新的 .md5 与 .sha256 并随 jar 一并提交。
- 校验文件与 jar 同仓存放只能防传输损坏、不能防仓库本身被写；发布时请在发布说明中另附 SHA-256 值。
