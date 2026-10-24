// 懂片帝 · 影视TV(FongMi/TV) QuickJS 源
// 站点形态：React SPA + 同源 /v1 JSON API，请求需客户端 HMAC-SHA256 签名
// 数据链路：feed/browse → catalog(detail+episodes) → playback/resolve →(必要时) resolve-line
//
// 部署：把本文件放到配置目录的 js/dongpian6.js，配置里写
//   {"key":"dongpiandi","name":"懂片帝","type":3,"api":"./js/dongpian6.js",
//    "ext":{"host":"https://dongpian6.com"}}
//
// 说明：
//  * 不落任何密钥常量 —— 首次调用时从站点 bundle 里提取签名密钥，进程内缓存；
//    站点换域名/换构建自动跟随（也可用 ext.key 手工指定）。
//  * 只用注入的 net/http，不自建请求栈。
//  * 失败一律抛错或返回 msg，绝不返回「成功但空列表」。

var DEF_HOST = "https://dongpian6.com";
var UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
var PAGE_LIMIT = 20;   // 列表每页
var EP_PAGE = 120;     // 站点剧集接口单次上限（实测硬顶 120）
var MAX_LINES = 4;     // 播放线路最多尝试几条

var HDR_TS = "x-ai-movie-timestamp";
var HDR_NONCE = "x-ai-movie-nonce";
var HDR_SIGN = "x-ai-movie-signature";

var KIND_LABEL = {
  movie: "电影", series: "电视剧", short_drama: "短剧", anime: "动漫",
  variety: "综艺", documentary: "纪录片", sports: "体育"
};

/* ───────────────────────── 纯 JS SHA-256 / HMAC-SHA256（QuickJS 无 WebCrypto） */

var SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function utf8Bytes(str) {
  var s = String(str == null ? "" : str);
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var c2 = s.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

function bytesToHex(bytes) {
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return s;
}

function sha256Bytes(bytes) {
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var msg = bytes.slice();
  var bitLen = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  msg.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  var w = new Array(64);
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  for (var off = 0; off < msg.length; off += 64) {
    for (var i = 0; i < 16; i++) {
      var j = off + i * 4;
      w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
    }
    for (i = 16; i < 64; i++) {
      var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  var out = new Array(32);
  for (i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

function hmacSha256Hex(key, msg) {
  var block = 64;
  var k = utf8Bytes(key);
  if (k.length > block) k = sha256Bytes(k);
  while (k.length < block) k.push(0);
  var ipad = [], opad = [];
  for (var i = 0; i < block; i++) { ipad.push(k[i] ^ 0x36); opad.push(k[i] ^ 0x5c); }
  return bytesToHex(sha256Bytes(opad.concat(sha256Bytes(ipad.concat(utf8Bytes(msg))))));
}

/* ───────────────────────────────── 工具 */

function num(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function str(v) {
  return v == null ? "" : String(v);
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function qs(params) {
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  }
  return parts.join("&");
}

// 注意：QuickJS 无 WebCrypto，注入桥接也不提供密码学随机源，Math.random 是唯一可用来源。
// 影响有限：nonce 只是 HMAC 输入之一，签名安全性主要依赖密钥不泄露与时间戳/路径绑定；
// 仅凭可预测的 nonce、没有密钥无法伪造请求。如宿主日后提供更强随机源，再替换此处。
function randomHex(n) {
  var s = "";
  while (s.length < n * 2) {
    s += Math.floor(Math.random() * 0x100000000).toString(16);
  }
  return s.slice(0, n * 2);
}

// 错误文本用路径脱敏：去掉 query，非固定段折叠为 [id]，只保留接口名与状态码。
// 影片 id / 播放 token 本身就在路径里，原样写进报错会随日志外泄。
var PATH_STATIC = { v1: 1, browse: 1, catalog: 1, detail: 1, episodes: 1,
  playback: 1, resolve: 1, "resolve-line": 1, feed: 1, home: 1, users: 1, anonymous: 1 };
function redactPath(target) {
  var path = str(target).split("?")[0];
  var parts = path.split("/").filter(function (p) { return p !== ""; })
    .map(function (p) { return PATH_STATIC[p] ? p : "[id]"; });
  return "/" + parts.join("/");
}

// 集数名里的分隔符要替换，避免污染播放串
function safeName(s) {
  return str(s).replace(/\$/g, "＄").replace(/#/g, "＃").replace(/\{/g, "｛").replace(/\}/g, "｝").trim();
}

// 返回类型兼容：多数分支（OK影视/看剧AI 这类 FongMi 内核分支）要求业务方法返回 **JSON 字符串**，
// 返回对象会 ClassCastException 并表现为「首页空白、分类为空」。默认给字符串，
// 只有 ext.json === false 时才返回对象（官方新版两者都吃）。
var RETURN_JSON = true;

/* ───────────────────────────────── 站点实现 */

function createSpider(site) {
  var host = DEF_HOST;
  var ext = {};
  var conf = null;          // { key: "<hmac key>" }
  var presetCache = {};     // token → skip preset
  var durCache = {};        // m3u8 url → 秒

  function init(e) {
    if (!e) return;
    if (typeof e === "string") {
      try { ext = JSON.parse(e) || {}; } catch (err) { ext = {}; }
    } else if (typeof e === "object") {
      ext = e;
    }
    if (ext.host) host = str(ext.host).replace(/\/+$/, "");
    if (ext.json === false) RETURN_JSON = false;
  }

  function ret(o) {
    return RETURN_JSON ? JSON.stringify(o) : o;
  }

  /* ── 网络：只用注入的 net/http，兼容「对象」与「JSON 字符串」两种返回
     注意：重定向行为由宿主桥接控制，脚本内无法禁用、也无法看到中间跳转。
     本文件无 Cookie 逻辑，重放面只剩签名头（且签名绑定原始路径，跨站后即失效），
     属桥接层限制，脚本无法从内部封堵。 */

  async function call(url, options) {
    var res;
    if (typeof net !== "undefined" && net && typeof net.req === "function") {
      res = await net.req(url, options);
    } else if (typeof net !== "undefined" && net && typeof net.http === "function") {
      res = await net.http(url, options);
    } else if (typeof http === "function") {
      res = await http(url, options);   // 部分分支：全局 http
    } else {
      throw new Error("运行环境未注入 net/http，无法联网（换官方 FongMi 版本或检查运行时）");
    }
    if (typeof res === "string") {
      try { res = JSON.parse(res); } catch (err) { res = { code: 200, content: res }; }
    }
    if (!res || typeof res !== "object") throw new Error("网络返回异常：" + str(res));
    return res;
  }

  function baseHeaders() {
    return {
      "User-Agent": UA,
      "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9",
      "Referer": host + "/",
      "Origin": host
    };
  }

  async function getText(url) {
    var res = await call(url, { headers: baseHeaders(), timeout: 20000 });
    var code = num(res.code);
    if (code && (code < 200 || code >= 300)) {
      throw new Error("HTTP " + code + " @ " + url);
    }
    return str(res.content);
  }

  /* ── 签名密钥：运行时从 bundle 提取（进程内缓存，不落盘不进日志） */

  function pickBundles(html) {
    var urls = [];
    var re = /(?:href|src)\s*=\s*["']([^"']*\/assets\/[A-Za-z0-9._\-\/]+\.js)["']/g;
    var m;
    // 只抓本站同 host 的 bundle：绝对地址的第三方 bundle 直接丢弃。
    // （本站相对地址以 host 补齐后天然同 host；裸相对地址保持原样、不做改写。）
    var siteHost = (function () {
      var hm = str(host).match(/^https?:\/\/([^\/:]+)/i);
      return hm ? hm[1].toLowerCase() : "";
    })();
    while ((m = re.exec(html)) !== null) {
      var u = m[1];
      if (u.indexOf("//") === 0) u = "https:" + u;
      else if (u.charAt(0) === "/") u = host + u;
      var um = u.match(/^https?:\/\/([^\/:]+)/i);
      if (um && um[1].toLowerCase() !== siteHost) continue;
      if (urls.indexOf(u) < 0) urls.push(u);
    }
    // 密钥通常在 runtime / main 这类包里，优先取，且限制抓取数量
    urls.sort(function (a, b) {
      function rank(x) {
        if (/movie-card-runtime/i.test(x)) return 0;
        if (/runtime/i.test(x)) return 1;
        if (/\/main-/i.test(x)) return 2;
        return 3;
      }
      return rank(a) - rank(b);
    });
    return urls.slice(0, 6);
  }

  async function ensureConf(force) {
    if (!force && conf && conf.key) return conf;
    if (ext.key) {
      conf = { key: str(ext.key) };
      return conf;
    }
    var html = await getText(host + "/");
    var urls = pickBundles(html);
    if (!urls.length) throw new Error("首页未找到 /assets/*.js，站点可能改版 @ " + host);
    for (var i = 0; i < urls.length; i++) {
      var js = "";
      try {
        js = await getText(urls[i]);
      } catch (err) {
        continue;
      }
      // 严格版：只接受带 .trim() 上下文的密钥形态；无上下文的裸 64-hex 回退已删除，
      // 取错密钥只会静默失败，不如直接报错（与 JS-kanju、Java 的严格版一致）。
      var m = js.match(/"([0-9a-f]{64})"\.trim\(\)/);
      if (m && m[1]) {
        conf = { key: m[1], from: urls[i] };
        return conf;
      }
    }
    throw new Error("未能从 bundle 提取签名密钥；可在配置 ext.key 手工指定（见 README「维护点」）");
  }

  function signHeaders(method, pathWithQuery, key) {
    var ts = String(Date.now());
    var nonce = randomHex(16);
    var canon = method.toUpperCase() + "\n" + pathWithQuery + "\n" + ts + "\n" + nonce;
    var h = baseHeaders();
    h[HDR_TS] = ts;
    h[HDR_NONCE] = nonce;
    h[HDR_SIGN] = hmacSha256Hex(key, canon);
    return h;
  }

  function errText(res, path) {
    var body = str(res.content);
    var code = "";
    try {
      var j = JSON.parse(body);
      if (j && typeof j === "object") {
        var er = j.error;
        if (er && typeof er === "object") code = str(er.code);
        else if (typeof er === "string") code = er;
        else code = str(j.code);
      }
    } catch (err) { /* 非 JSON */ }
    // 只保留状态码与接口名：响应体片段与服务端 message 一律不进错误文本；
    // 路径也要脱敏（播放 token 本身就在路径里），query 直接丢掉。
    return "HTTP " + num(res.code) + " " + (code ? "[" + code + "] " : "") + "@ " + redactPath(path);
  }

  // pathWithQuery 形如 "/v1/browse/catalog?page=1&limit=20"；签名对它整体计算
  async function api(method, pathWithQuery, body, retried) {
    var c = await ensureConf(false);
    var url = host + pathWithQuery;
    var options = { headers: signHeaders(method, pathWithQuery, c.key), timeout: 20000 };
    if (body !== undefined && body !== null) {
      options.method = "POST";
      options.postType = "json";
      options.data = body;
    } else if (method === "POST") {
      options.method = "POST";
      options.postType = "json";
      options.data = {};
    }
    var res = await call(url, options);
    var code = num(res.code);
    if (code === 401 && !retried) {
      // 签名密钥被站点轮换 → 重抓一次 bundle 再试一次
      await ensureConf(true);
      return api(method, pathWithQuery, body, true);
    }
    if (code && (code < 200 || code >= 300)) throw new Error(errText(res, pathWithQuery));
    var txt = str(res.content);
    if (!txt) throw new Error("空响应 @ " + pathWithQuery);
    try {
      return JSON.parse(txt);
    } catch (err) {
      throw new Error("响应不是 JSON @ " + redactPath(pathWithQuery));
    }
  }

  function apiGet(pathWithQuery) { return api("GET", pathWithQuery, null, false); }
  function apiPost(pathWithQuery, body) { return api("POST", pathWithQuery, body || {}, false); }

  /* ── 卡片映射 */

  function toVod(c) {
    if (!c || !c.id) return null;
    return {
      vod_id: str(c.id),
      vod_name: str(c.title || c.normalized_title),
      vod_pic: str(c.poster_url || c.carousel_url || c.backdrop_url),
      vod_remarks: str(c.remarks),
      vod_year: c.year ? str(c.year) : "",
      vod_area: str(c.area),
      type_name: KIND_LABEL[str(c.content_kind)] || str(c.content_kind),
      vod_content: ""
    };
  }

  function toList(cards) {
    var out = [];
    var seen = {};
    for (var i = 0; i < cards.length; i++) {
      var v = toVod(cards[i]);
      if (!v || seen[v.vod_id]) continue;
      seen[v.vod_id] = 1;
      out.push(v);
    }
    return out;
  }

  function pageOf(j, pg, limit) {
    var p = j.pagination || {};
    var page = num(p.page) || num(pg) || 1;
    var total = num(p.total);
    var pagecount;
    if (total > 0) pagecount = Math.max(1, Math.ceil(total / limit));
    else if (p.has_more === true) pagecount = page + 1;
    else pagecount = page;
    return { page: page, pagecount: pagecount, limit: limit };
  }

  /* ── 首页分类 + 筛选 */

  function areaFilter() {
    return [
      { n: "全部", v: "" }, { n: "中国大陆", v: "中国大陆" }, { n: "美国", v: "美国" },
      { n: "韩国", v: "韩国" }, { n: "日本", v: "日本" }, { n: "中国香港", v: "中国香港" },
      { n: "中国台湾", v: "中国台湾" }, { n: "英国", v: "英国" }, { n: "泰国", v: "泰国" },
      { n: "法国", v: "法国" }, { n: "印度", v: "印度" }
    ];
  }

  function yearFilter() {
    var out = [{ n: "全部", v: "" }];
    var y = new Date().getFullYear() + 1;
    for (var i = 0; i < 12; i++) out.push({ n: String(y - i), v: String(y - i) });
    return out;
  }

  function genreFilter() {
    var gs = ["动作", "喜剧", "爱情", "悬疑", "科幻", "恐怖", "剧情", "战争", "犯罪",
      "奇幻", "冒险", "武侠", "家庭", "历史", "音乐", "运动", "灾难", "青春", "古装", "惊悚"];
    var out = [{ n: "全部", v: "" }];
    for (var i = 0; i < gs.length; i++) out.push({ n: gs[i], v: gs[i] });
    return out;
  }

  function sortFilter() {
    return [
      { n: "最新", v: "latest" },
      { n: "日榜", v: "trending_day" },
      { n: "周榜", v: "trending_week" }
    ];
  }

  function home(filter) {
    var classList = [
      { type_id: "trend", type_name: "大家都在看" },
      { type_id: "movie", type_name: "电影" },
      { type_id: "series", type_name: "电视剧" },
      { type_id: "short_drama", type_name: "短剧" },
      { type_id: "anime", type_name: "动漫" },
      { type_id: "variety", type_name: "综艺" },
      { type_id: "documentary", type_name: "纪录片" },
      { type_id: "sports", type_name: "体育" }
    ];
    var result = { class: classList };
    if (filter) {
      var rows = [
        { key: "sort", name: "排序", init: "latest", value: sortFilter() },
        { key: "area", name: "地区", init: "", value: areaFilter() },
        { key: "year", name: "年份", init: "", value: yearFilter() },
        { key: "genre", name: "类型", init: "", value: genreFilter() }
      ];
      var trendRows = [
        { key: "window", name: "周期", init: "day", value: [{ n: "今日", v: "day" }, { n: "本周", v: "week" }] }
      ];
      var filters = {};
      for (var i = 0; i < classList.length; i++) {
        var tid = classList[i].type_id;
        // 键必须与 type_id 逐字一致
        filters[tid] = tid === "trend" ? trendRows : rows;
      }
      result.filters = filters;
    }
    return ret(result);
  }

  async function homeVod() {
    try {
      var j = await apiGet("/v1/feed/home?" + qs({ scope: "public", mode: "page", sections: 6, cards: 12 }));
      var secs = arr(j.sections);
      var cards = [];
      for (var i = 0; i < secs.length; i++) {
        var cs = arr(secs[i].cards);
        for (var k = 0; k < cs.length; k++) cards.push(cs[k]);
      }
      var list = toList(cards);
      if (list.length) return ret({ list: list });
      throw new Error("feed 返回 0 条");
    } catch (err) {
      // 推荐流是锦上添花：失败就用「大家都在看」垫上，不让首页空白
      var c = await category("trend", 1, false, {});
      return ret({ list: c.list });
    }
  }

  /* ── 分类列表 */

  async function category(tid, pg, filter, extend) {
    var e = extend || {};
    var page = num(pg) || 1;
    var params = { page: String(page), limit: String(PAGE_LIMIT) };

    if (tid === "trend") {
      params.sort = "trending";
      params.window = e.window === "week" ? "week" : "day";
    } else {
      params.kind = tid;
      var sortKey = e.sort || "latest";
      if (sortKey === "trending_day") { params.sort = "trending"; params.window = "day"; }
      else if (sortKey === "trending_week") { params.sort = "trending"; params.window = "week"; }
      else params.intent = "latest_catalog";
      if (e.area) params.area = str(e.area);
      if (e.year) params.year = str(e.year);
      if (e.genre) params.genre = str(e.genre);
    }

    var path = "/v1/browse/catalog?" + qs(params);
    var j = await apiGet(path);
    var list = toList(arr(j.cards));
    if (!list.length && page === 1) {
      var st = arr(j.source_statuses);
      for (var i = 0; i < st.length; i++) {
        if (str(st[i].status) === "failed") {
          throw new Error("数据源失败：" + str(st[i].message) + " @ " + path);
        }
      }
    }
    var p = pageOf(j, page, PAGE_LIMIT);
    return ret({ list: list, page: p.page, pagecount: p.pagecount, limit: p.limit });
  }

  /* ── 搜索 */

  async function search(key, quick, pg) {
    var word = str(key).trim();
    var page = num(pg) || 1;
    if (!word) return ret({ list: [], page: 1, pagecount: 1, limit: PAGE_LIMIT });
    var params = { q: word, page: String(page), limit: String(PAGE_LIMIT), intent: "catalog_search" };
    var path = "/v1/browse/catalog?" + qs(params);
    var j = await apiGet(path);
    var list = toList(arr(j.cards));
    var p = pageOf(j, page, PAGE_LIMIT);
    return ret({ list: list, page: p.page, pagecount: p.pagecount, limit: p.limit });
  }

  /* ── 详情：剧集（站点单次最多 120，按 offset 补齐） */

  function epList(j) {
    var out = [];
    var seen = {};
    var eps = arr(j.episodes);
    for (var i = 0; i < eps.length; i++) {
      var e = eps[i];
      var tok = str(e.token);
      if (!tok || seen[tok]) continue;
      seen[tok] = 1;
      var name = str(e.title) || ("第" + num(e.number) + "集");
      out.push({ name: safeName(name), token: tok, number: num(e.number) });
    }
    return out;
  }

  async function detail(id) {
    var vid = str(id).trim();
    if (!vid) throw new Error("detail: 缺少影片 ID");
    var base = "/v1/catalog/" + encodeURIComponent(vid);
    var j = await apiGet(base + "?" + qs({ episode_limit: String(EP_PAGE), episode_offset: "0" }));

    var eps = epList(j);
    var total = num(j.episode_count) || num(j.total_episode_count) || eps.length;
    var guard = 0;
    while (eps.length > 0 && eps.length < total && guard < 4) {
      guard++;
      var more = await apiGet(base + "/episodes?" + qs({ limit: String(EP_PAGE), offset: String(eps.length) }));
      var batch = epList(more);
      if (!batch.length) break;
      var seen = {};
      for (var i = 0; i < eps.length; i++) seen[eps[i].token] = 1;
      var added = 0;
      for (i = 0; i < batch.length; i++) {
        if (seen[batch[i].token]) continue;
        seen[batch[i].token] = 1;
        eps.push(batch[i]);
        added++;
      }
      if (!added) break;
    }

    // 跳过片头/片尾预设：按 token 暂存，play() 时生成 skips
    var preset = j.playback_skip_settings_preset || {};
    var introEnd = num(preset.intro_end_seconds);
    var outroFromEnd = num(preset.outro_from_end_seconds);
    for (var k = 0; k < eps.length; k++) {
      if (introEnd > 0 || outroFromEnd > 0) {
        presetCache[eps[k].token] = { intro: introEnd, outro: outroFromEnd };
      }
    }

    var playFrom = "懂片帝";
    var pieces = [];
    for (k = 0; k < eps.length; k++) pieces.push(eps[k].name + "$" + eps[k].token);
    var playUrl = pieces.join("#");
    if (!playUrl) throw new Error("详情没有剧集（token 为空）@ " + base);

    var genres = arr(j.genres).join(" ");
    var actors = arr(j.actors).join(" ");
    var directors = arr(j.directors).join(" ");

    return ret({
      list: [{
        vod_id: vid,
        vod_name: str(j.title || j.normalized_title),
        vod_pic: str(j.poster_url || j.backdrop_url),
        vod_remarks: str(j.remarks || j.episode_progress_text),
        vod_year: j.year ? str(j.year) : "",
        vod_area: str(j.area),
        type_name: KIND_LABEL[str(j.content_kind)] || str(j.content_kind),
        vod_actor: actors,
        vod_director: directors,
        vod_content: str(j.description) + (genres ? "\n类型：" + genres : ""),
        vod_play_from: playFrom,
        vod_play_url: playUrl
      }]
    });
  }

  /* ── 播放：resolve → 按 url_kind 决定是否需要 resolve-line */

  function lineRank(l, prefer) {
    var score = 0;
    var label = str(l.label) + " " + str(l.display_label);
    var prov = str(l.provider_id);
    if (prefer && (prov.indexOf(prefer) >= 0 || label.indexOf(prefer) >= 0)) score -= 100;
    var kind = str(l.url_kind);
    if (kind === "m3u8") score += 0;
    else if (kind === "mp4") score += 1;
    else if (kind === "resolve_ticket" || str(l.url).indexOf("resolve://") === 0) score += 2;
    else score += 3;
    if (l.selected === true) score -= 0.5;
    return score;
  }

  function pickLines(lines) {
    var prefer = str(ext.line);
    var cand = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (num(l.minimum_user_level) > 0) continue;   // 要登录/付费的线路，跳过
      if (!str(l.url)) continue;
      cand.push(l);
    }
    cand.sort(function (a, b) { return lineRank(a, prefer) - lineRank(b, prefer); });
    return cand.slice(0, MAX_LINES);
  }

  async function resolveLine(ticket) {
    var j = await apiPost("/v1/playback/resolve-line?" + qs({ view: "compact" }), { ticket: ticket });
    var line = j.line || {};
    var url = str(line.url);
    if (!url) throw new Error("resolve-line 返回空地址");
    return url;
  }

  function isHls(url) {
    var u = str(url).toLowerCase();
    return u.indexOf(".m3u8") >= 0 || u.indexOf("m3u8") >= 0;
  }

  // 校验线路可达性：HLS 顺手算总时长（片尾跳过要用）；mp4 只取头部 1KB 试探
  async function probeMedia(url) {
    var hls = isHls(url);
    if (durCache[url] != null) return { ok: true, duration: durCache[url] };
    var headers = { "User-Agent": UA, "Referer": host + "/" };
    // Range 是否生效取决于宿主桥接，脚本内无法验证；mp4 探活只依赖状态码，不依赖实际只读 1KB。
    if (!hls) headers.Range = "bytes=0-1023";
    var res;
    try {
      res = await call(url, { headers: headers, timeout: 12000 });
    } catch (err) {
      return { ok: false, duration: 0, why: "连接失败" };
    }
    var code = num(res.code);
    var txt = str(res.content);
    if (!code) return { ok: false, duration: 0, why: "无响应" + (res.error ? " " + str(res.error) : "") };
    if (code < 200 || code >= 400) return { ok: false, duration: 0, why: "HTTP " + code };
    var duration = 0;
    if (hls) {
      if (txt.indexOf("#EXTM3U") < 0) return { ok: false, duration: 0, why: "不是 HLS 清单" };
      // 清单只扫描前 512KB：桥接已把全文交给脚本，截断省的是正则扫描时间而非桥接内存；
      // 超限时 duration 为下界估计，片尾跳过仍受 duration > outro + 60 保护，不会多跳。
      var scan = txt.length > 512 * 1024 ? txt.slice(0, 512 * 1024) : txt;
      var re = /#EXTINF:\s*([0-9.]+)/g;
      var m;
      while ((m = re.exec(scan)) !== null) duration += num(m[1]);
      durCache[url] = duration;
    }
    return { ok: true, duration: duration };
  }

  function buildSkips(token, url, duration) {
    var pre = presetCache[token];
    if (!pre || ext.skips === false) return null;
    var skips = [];
    if (pre.intro > 0 && ext.skipIntro !== false) {
      skips.push({ type: "opening", start: 0, end: Math.round(pre.intro * 1000) });
    }
    if (pre.outro > 0 && ext.skipOutro !== false && duration > pre.outro + 60) {
      skips.push({ type: "ending", start: Math.round((duration - pre.outro) * 1000) });
    }
    return skips.length ? skips : null;
  }

  async function play(flag, id, vipFlags) {
    var token = str(id).trim();
    if (!token) return ret({ parse: 0, msg: "缺少播放 token" });
    var path = "/v1/playback/resolve/" + encodeURIComponent(token);
    var j = await apiGet(path);
    var lines = arr(j.line_options);
    if (!lines.length) return ret({ parse: 0, msg: "该集没有可用线路（line_options 为空）" });

    var cand = pickLines(lines);
    if (!cand.length) return ret({ parse: 0, msg: "所有线路都需要登录/付费（minimum_user_level > 0）" });

    var lastErr = "";
    var unverified = null;   // 全部线路都没通过可达性校验时的兜底
    var verify = ext.verify !== false;

    for (var i = 0; i < cand.length; i++) {
      var l = cand[i];
      var url = str(l.url);
      try {
        if (url.indexOf("resolve://") === 0) {
          url = await resolveLine(url.slice("resolve://".length).trim());
        }
        if (!/^https?:\/\//i.test(url)) throw new Error("线路地址不是 http(s)");

        var probe = { ok: true, duration: 0 };
        if (verify) {
          probe = await probeMedia(url);
          if (!probe.ok) {
            lastErr = str(l.provider_id) + " 不可达（" + str(probe.why) + "）";
            if (!unverified) unverified = { url: url, line: l };
            continue;
          }
        }

        var skips = null;
        try { skips = buildSkips(token, url, num(probe.duration)); } catch (err) { skips = null; }
        var res1 = {
          parse: 0,
          url: url,
          header: { "User-Agent": UA, "Referer": host + "/" }
        };
        // 注意：成功时切勿带 msg —— 多数分支把 msg 当「错误提示/失败原因」，
        // 带了会直接中止播放（实测：mpv 停在 idle，视频区只剩一个报错标签）。
        if (isHls(url)) res1.format = "application/x-mpegURL";
        if (skips) res1.skips = skips;
        return ret(res1);
      } catch (err) {
        var em = err && err.message ? err.message : str(err);
        lastErr = str(l.provider_id) + ":" + str(em).slice(0, 80);
      }
    }

    // 全部未通过校验：仍给第一条（设备网络/临时故障时比黑屏好），并把原因带出去
    if (unverified) {
      var u2 = unverified.url;
      var o2 = {
        parse: 0,
        url: u2,
        header: { "User-Agent": UA, "Referer": host + "/" }
      };
      if (isHls(u2)) o2.format = "application/x-mpegURL";
      return ret(o2);
    }

    // 全部线路失败：交给 App 嗅探站点播放页，并带上原因
    return ret({
      parse: 1,
      url: host + "/player/" + encodeURIComponent(token),
      header: { "User-Agent": UA, "Referer": host + "/" },
      msg: "线路解析失败（" + lastErr + "），已改用网页嗅探"
    });
  }

  return { init: init, home: home, homeVod: homeVod, category: category, search: search, detail: detail, play: play };
}

export default createSpider;
