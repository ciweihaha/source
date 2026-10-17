# 看剧AI 视频源（TVBox / FongMi / 影视TV）

面向 [kanju.ai](https://kanju.ai) 的多实现视频源仓库：**Python / JS（drpy2）/ Java**。
三版功能对齐：分类、筛选、搜索、详情、剧集、多线路播放；域名统一 `https://kanju.ai`。

> 本仓库只包含客户端源代码与配置，不存储、不转码、不分发任何媒体文件。

## 目录结构

```
source/
├─ README.md
├─ python/                     FongMi / 影视TV（type 3 · Python，Chaquopy）
│  ├─ kanju3.py                源本体（签名密钥运行时提取）
│  └─ kanju3.json              配置（api: ./kanju3.py）
├─ js/                         drpy2（TVBox 系）
│  ├─ kanju.js                 源本体（rule 对象，内置 HMAC-SHA256）
│  └─ kanju.json               配置（ext 指向 ./js/kanju.js）
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
| JS（drpy2） | TVBox + drpy2（影视仓 / OK影视 / TVBoxOS） | `https://cdn.jsdelivr.net/gh/z2004y/source@main/js/kanju.json` |
| Java | TVBox / CatVodSpider（不需要额外运行时） | `https://cdn.jsdelivr.net/gh/z2004y/source@main/java/kanju_jar.json` |

GitHub 直链把 `cdn.jsdelivr.net/gh/z2004y/source@main/` 换成 `raw.githubusercontent.com/z2004y/source/main/` 即可。

### Python

1. `设置 → 点播 → 粘贴配置地址 → 确定`
2. 回首页选「看剧AI」
3. 可选 `ext`：`host`（默认 `https://kanju.ai`）、`line`（线路名片段，如 `1080P`）

特点：签名密钥**运行时从站点 bundle 提取**；有 `self.net` 走 App 网络，没有则降级 `urllib`；
播放直链优先 + `resolve://` 二次解析 + 5 条线路回退；401 自动建匿名会话重试。

### JS（drpy2）

- 依赖 drpy2 运行时（配置里的 `spider` 已指向公开 drpy2，走 gh-proxy 加速）；
- App 若已内置 drpy2，可删掉配置中的 `spider` 字段；
- 站点名「看剧AI」。

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
| Python | ✅ | ✅ 8 分类 | ✅ | ✅ `/media` state=3，进度前进 |
| Java（本仓库 jar） | ✅ | ✅ 8 分类 | ✅ | ✅ state=3，+6s/6s |
| JS（drpy2） | 需 TVBox + drpy2 客户端（OKTV 无 drpy2，未在设备验证） | — | — | — |
| JS 签名实现 | Node 对照 crypto 一致；直连 `/v1/browse/catalog` 200 | — | — | — |

## 维护

- 换签名协议：Python / Java 改 `canonical` 与密钥正则；drpy2 版更新 `SIGN_KEY` 与版本常量；
- Java 改完：`javac → d8 → jar → 更新 spider.jar.md5`；
- 域名变更：三版默认 host + 配置 `ext.host` 一起改。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 站点出现但分类空白 | 运行时不被支持 | 换版本（见上表） |
| Java 报 `ClassNotFoundException: ...Proxy` | jar 缺 Proxy | 用本仓库 jar |
| Java 报 `Failed to open dex files` | jar 内是 `.class` 不是 `classes.dex` | 用本仓库 jar 或按 BUILD.md 重打包 |
| 选集黑屏 | 线路失效 / 地址过期 | 源已做 5 条线路回退；可指定 `ext.line` |

## 免责

代码仅用于个人学习与自建源调试。内容版权归原站点与权利人所有，本仓库不存储、不转码、不分发任何媒体文件。
