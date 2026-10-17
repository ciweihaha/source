# 看剧AI 视频源

面向 [kanju.ai](https://kanju.ai) 的视频源，提供 **Python / JS（QuickJS）/ Java** 三种实现，功能对齐：
分类、筛选、搜索、详情、剧集、多线路播放。

- 站点域名：`https://kanju.ai`（同源 `kanju3.com`）
- 配置路径：全部使用相对路径，便于自建镜像
- 内容说明：仓库只含客户端代码与配置，不存储、不转码、不分发媒体文件

---

## 目录

- [特性](#特性)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [配置字段](#配置字段)
- [接口说明](#接口说明)
- [签名机制](#签名机制)
- [验证记录](#验证记录)
- [常见问题](#常见问题)
- [维护与更新](#维护与更新)
- [免责](#免责)

---

## 特性

| 能力 | 说明 |
|---|---|
| 分类 | 全部 / 电影 / 剧集 / 短剧 / 动漫 / 综艺 / 纪录片 / 体育 |
| 筛选 | 年份、地区 |
| 搜索 | 站点 `q=` 检索，单页 20 条 |
| 详情 | 片名、封面、年份、地区、类型、导演、演员、简介、集数 |
| 播放 | 直链优先 → `resolve://` 二次解析 → 最多 5 条线路回退 |
| 稳健性 | 签名密钥运行时提取；401 自动建匿名会话重试一次 |
| 首页 | 站点 `/v1/feed/home` 多分区推荐，失败回退分类首页 |

---

## 目录结构

```
source/
├─ README.md
├─ python/                     FongMi 内核 + Chaquopy（影视TV / OKTV）
│  ├─ kanju.py                 源本体（type 3）
│  └─ kanju.json               配置（api: ./kanju.py）
├─ js/                         FongMi QuickJS（影视TV / OKTV，无需 Python）
│  ├─ kanju.js                 源本体（双桥接 + 纯 JS HMAC）
│  └─ kanju.json               配置（api: ./kanju.js）
└─ java/                       TVBox / CatVodSpider / FongMi（dex jar）
   ├─ spider.jar               含 csp_Kanju + Proxy
   ├─ spider.jar.md5           与 jar 对齐
   ├─ kanju_jar.json           配置（spider: ./spider.jar）
   ├─ src/Kanju.java           源码
   ├─ src/Proxy.java           加载器兼容壳
   └─ BUILD.md                 编译 / d8 / 打包步骤
```

---

## 快速开始

配置地址（任选其一，可换成自建镜像）：

| 版本 | 地址 |
|---|---|
| Python | `https://raw.githubusercontent.com/z2004y/source/main/python/kanju.json` |
| JS | `https://raw.githubusercontent.com/z2004y/source/main/js/kanju.json` |
| Java | `https://raw.githubusercontent.com/z2004y/source/main/java/kanju_jar.json` |

### Python

1. `设置 → 点播 → 粘贴地址 → 确定`
2. 回首页选「看剧AI」
3. 可选 `ext` 见[配置字段](#配置字段)

需要客户端带 **Chaquopy**。

### JS（QuickJS）

同上步骤，站点名「看剧AI(JS)」。源码做过桥接适配：

- 官方桥接：`net.http(url, opts)`；
- 部分分支（OKTV）：全局 `http(url, opts)`，且方法**必须返回 JSON 字符串**；
- 启动时自动探测，两种都能跑；
- 不使用并发 HTTP（该桥接会互相取消），详情/剧集串行请求。

### Java

- `spider` 为相对路径 `./spider.jar`，与配置同目录解析；
- 入口类 `com.github.catvod.spider.Kanju`，`api` 为 `csp_Kanju`；
- 自行构建见 [`java/BUILD.md`](java/BUILD.md)。

### 自建镜像 / 局域网

配置里 `./kanju.py`、`./kanju.js`、`./spider.jar` 都按**配置文件所在目录**解析，镜像只需整目录拷贝：

```bash
cd js             # 或 python / java
python -m http.server 8000
# App 配置地址： http://<电脑IP>:8000/kanju.json
```

---

## 配置字段

### Python / JS（`python/kanju.json`、`js/kanju.json`）

| 字段 | 说明 |
|---|---|
| `sites[].key` | `kanju`（JS 为 `kanju_js`） |
| `sites[].api` | `./kanju.py` / `./kanju.js`（相对配置位置） |
| `sites[].ext.host` | 站点根地址，默认 `https://kanju.ai` |
| `sites[].ext.line` | 强制线路名片段（如 `1080P`），留空=默认 |
| `sites[].searchable` / `quickSearch` | `1` 启用 |

### Java（`java/kanju_jar.json`）

| 字段 | 值 |
|---|---|
| `spider` | `./spider.jar` |
| `sites[].api` | `csp_Kanju` |
| `sites[].type` | `3` |

---

## 接口说明

| 用途 | 请求 |
|---|---|
| 分类 / 搜索 | `GET /v1/browse/catalog?page=&limit=&kind=&year=&area=&q=` |
| 首页推荐 | `GET /v1/feed/home?scope=public&mode=preview&sections=3&cards=10` |
| 详情 | `GET /v1/catalog/{id}/detail` |
| 剧集 | `GET /v1/catalog/{id}/episodes?limit=48&offset=0` |
| 线路列表 | `GET /v1/playback/resolve/{episode_token}?view=compact` |
| 最终地址 | `POST /v1/playback/resolve-line` body `{"ticket":"<public_id>"}` |

```mermaid
flowchart LR
  A[browse/feed] --> B[catalog detail]
  B --> C[episodes]
  C --> D[playback resolve]
  D --> E{url_kind}
  E -- 直链 --> F[媒体地址]
  E -- resolve:// --> G[resolve-line] --> F
```

---

## 签名机制

站点对 `/v1/*` 强制客户端 HMAC 签名：

```
canonical = "{METHOD}\n{path?query}\n{timestamp_ms}\n{nonce_hex32}"
signature = HMAC-SHA256(key, canonical).hex()
```

请求头：`x-ai-movie-timestamp / -nonce / -signature / -client-name / -client-version / -build-version / -protocol-version`。

实现要点：

1. **密钥不硬编码**：启动时抓首页 → 定位 `assets/movie-card-runtime-*.js` → 正则提取 key 与版本号；
2. **会话**：401 `playback_user_session_required` 时 `POST /v1/users/anonymous`，重签重试一次；
3. **错误显形**：异常带「接口 + code + 响应片段」，不返回成功空列表。

---

## 验证记录

环境：雷电 14（Android 14）+ OKTV 5.2.1（FongMi 内核）。

| 版本 | 载入 | 分类 | 详情 | 播放 | 备注 |
|---|---|---|---|---|---|
| Python | ✅ | ✅ 8 分类 | ✅ | ✅ `state=3` 进度前进 | jar 不需要 |
| JS（QuickJS） | ✅ | ✅ 8 分类 | ✅ 7 集 | ✅ `state=3` +6022ms/6s | 双桥接自动适配 |
| Java | ✅ | ✅ 8 分类 | ✅ | ✅ `state=3` +6035ms/6s | dex jar |

---

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 站点不出现 | 配置地址打不开 | 手机浏览器直接访问配置地址确认 |
| 分类空 | 客户端缺对应运行时 | Python 版换 JS/Java；或反过来 |
| JS 报 `'net' is not defined` | 该分支用全局 `http` | 用本仓库 `js/kanju.js`（已双桥接） |
| JS 报 `ClassCastException ... to String` | 该分支要求返回 JSON 字符串 | 仓库版本已统一返回字符串 |
| JS 详情空白 | 并发 HTTP 被桥接取消 | 仓库版本已改串行 |
| Java 报 `ClassNotFoundException: ...Proxy` | jar 缺 Proxy | 用仓库 jar |
| Java 报 `Failed to open dex files` | jar 内是 `.class` 不是 `classes.dex` | 用仓库 jar（d8 生成） |
| 选集黑屏 | 线路失效 / 地址过期 | 已做 5 条回退；可用 `ext.line` 指定 |

---

## 维护与更新

| 场景 | 操作 |
|---|---|
| 站点改签名 | 改 `canonical` 与密钥正则（三版同名逻辑） |
| 新增分类 | 改 `KINDS`（三版） |
| 改线路策略 | 改 `ordered/rank`（三版） |
| 更新 Java | `javac → d8 → jar → 更新 spider.jar.md5` |
| 换域名 | 三版默认 host + 配置 `ext.host` |

---

## 免责

代码仅用于个人学习与自建源调试。内容版权归原站点与权利人所有，本仓库不存储、不转码、不分发任何媒体文件。
