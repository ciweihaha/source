# 看剧AI 视频源（FongMi / 影视TV / TVBox）

面向 [kanju.ai](https://kanju.ai) 的视频源，提供 **Python** 与 **Java** 两个实现，域名统一 `https://kanju.ai`。
功能对齐：分类、筛选、搜索、详情、剧集、多线路播放。

> 本仓库只包含客户端源代码与配置，不存储、不转码、不分发任何媒体文件。

## 目录结构

```
source/
├─ README.md
├─ python/                     FongMi / 影视TV（type 3 · Python，Chaquopy）
│  ├─ kanju3.py                源本体（签名密钥运行时提取）
│  └─ kanju3.json              配置（api: ./kanju3.py）
└─ java/                       CatVodSpider（TVBox / FongMi，dex jar）
   ├─ spider.jar               含 csp_Kanju + Proxy
   ├─ spider.jar.md5           与 jar 对齐
   ├─ kanju_jar.json           配置（api: csp_Kanju）
   ├─ src/Kanju.java           源码
   ├─ src/Proxy.java           加载器兼容壳
   └─ BUILD.md                 编译/打包步骤
```

## 快速开始

| 版本 | 适用客户端 | 配置地址 |
|---|---|---|
| Python | FongMi 内核 + Chaquopy（影视TV / OKTV） | `https://cdn.jsdelivr.net/gh/z2004y/source@main/python/kanju3.json` |
| Java | TVBox / CatVodSpider / FongMi（无需额外运行时） | `https://cdn.jsdelivr.net/gh/z2004y/source@main/java/kanju_jar.json` |

GitHub 直链把 `cdn.jsdelivr.net/gh/z2004y/source@main/` 换成 `raw.githubusercontent.com/z2004y/source/main/` 即可。

### Python

1. `设置 → 点播 → 粘贴配置地址 → 确定`
2. 回首页选「看剧AI」
3. 可选 `ext`：`host`（默认 `https://kanju.ai`）、`line`（线路名片段，如 `1080P`）

特点：签名密钥**运行时从站点 bundle 提取**；有 `self.net` 走 App 网络，没有则降级 `urllib`；
播放直链优先 + `resolve://` 二次解析 + 5 条线路回退；401 自动建匿名会话重试一次。

### Java

- 入口类 `com.github.catvod.spider.Kanju`（`api: csp_Kanju`）；
- jar 为 **dex 格式**（内部 `classes.dex`），并含加载器必需的 `Proxy`；
- 自行构建见 `java/BUILD.md`。

## 接口与签名

```
分类/搜索  GET  /v1/browse/catalog?page=&limit=&kind=&year=&area=&q=
详情       GET  /v1/catalog/{id}/detail
剧集       GET  /v1/catalog/{id}/episodes?limit=48&offset=0
线路       GET  /v1/playback/resolve/{episode_token}?view=compact
最终地址   POST /v1/playback/resolve-line  {"ticket":"<public_id>"}
```

```
canonical = "{METHOD}\n{path?query}\n{timestamp_ms}\n{nonce_hex32}"
signature = HMAC-SHA256(key, canonical).hex()
```

必需头：`x-ai-movie-timestamp / -nonce / -signature / -client-name / -client-version / -build-version / -protocol-version`。

## 验证记录

环境：雷电 14（Android 14）+ OKTV 5.2.1（FongMi 内核）。

| 版本 | 载入 | 分类 | 详情 | 播放 |
|---|---|---|---|---|
| Python | ✅ 看剧AI | ✅ 8 分类 | ✅ | ✅ `/media` state=3，进度前进 |
| Java | ✅ 看剧AI(Java) | ✅ 8 分类 | ✅ | ✅ state=3，+6035ms/6s |

## 维护

- 换签名协议：改 `canonical` 与密钥正则（Python 在 `_api()` / `_fetch_signing()`，Java 在 `signedRequest()` / `ensureSigning()`）；
- Java 改完：`javac → d8 → jar → 更新 spider.jar.md5`；
- 域名变更：两版默认 host + Python 配置 `ext.host` 一起改。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 站点出现但分类空白 | 客户端无 Python 运行时 | 改用 Java 版配置 |
| Java 报 `ClassNotFoundException: ...Proxy` | jar 缺 Proxy | 用本仓库 jar |
| Java 报 `Failed to open dex files` | jar 内是 `.class` 不是 `classes.dex` | 用本仓库 jar 或按 BUILD.md 重打包 |
| 选集黑屏 | 线路失效 / 地址过期 | 源已做 5 条线路回退；可指定 `ext.line` |

## 免责

代码仅用于个人学习与自建源调试。内容版权归原站点与权利人所有，本仓库不存储、不转码、不分发任何媒体文件。
