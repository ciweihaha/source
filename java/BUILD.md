# Java 版构建说明

```bash
# 1) 编译桩（仅编译期，不打进 jar）
javac -source 8 -target 8 -classpath "$ANDROID_HOME/platforms/android-36/android.jar" \
      -d stubs stub/com/github/catvod/crawler/Spider.java

# 2) 编译爬虫
javac -source 8 -target 8 -encoding UTF-8 \
      -classpath "$ANDROID_HOME/platforms/android-36/android.jar;stubs" \
      -d out src/com/github/catvod/spider/Kanju.java src/com/github/catvod/spider/Proxy.java

# 3) 转 dex（Android 只能加载 dex）
d8 --release --min-api 23 \
   --lib "$ANDROID_HOME/platforms/android-36/android.jar" --lib stubs \
   --output dexout $(find out -name '*.class')

# 4) 打包
jar cf spider.jar -C dexout classes.dex
md5sum spider.jar > spider.jar.md5
```

要点：

- App 要求 jar 内是 `classes.dex`（不是 `.class`），否则 `Failed to open dex files`；
- 必须包含 `com.github.catvod.spider.Proxy`，否则加载器 `ClassNotFoundException` 导致爬虫为 null；
- 签名密钥运行时从站点 bundle 提取，换构建不需要重打包。
