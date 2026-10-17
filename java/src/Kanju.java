package com.github.catvod.spider;

import android.content.Context;
import com.github.catvod.crawler.Spider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * 看剧AI 源（kanju.ai）· Java Spider
 *
 * 接口：/v1/browse/catalog、/v1/catalog/{id}/detail|episodes、
 *       /v1/playback/resolve/{token}、/v1/playback/resolve-line
 *
 * 签名：HMAC-SHA256(key, "{METHOD}\n{path?query}\n{timestamp_ms}\n{nonce}")
 * 密钥不硬编码：启动时从站点 JS bundle 提取。
 */
public class Kanju extends Spider {

    private static final String DEFAULT_HOST = "https://kanju.ai";
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    private static final int PAGE_LIMIT = 20;
    private static final int MAX_LINE_TRIES = 5;

    private static final String[][] KINDS = {
            {"", "全部"}, {"movie", "电影"}, {"series", "剧集"}, {"short_drama", "短剧"},
            {"anime", "动漫"}, {"variety", "综艺"}, {"documentary", "纪录片"}, {"sports", "体育"}
    };
    private static final String[] AREAS = {"大陆", "香港", "台湾", "日本", "韩国", "欧美"};

    private static final Pattern RUNTIME_JS =
            Pattern.compile("/assets/movie-card-runtime-[A-Za-z0-9_\\-]+\\.js");
    private static final Pattern SIGN_KEY =
            Pattern.compile("x-ai-movie-signature\",[^;]{0,200}?\"([0-9a-f]{64})\"");
    private static final Pattern BUILD_VER =
            Pattern.compile("dianyingtiantang-v[0-9][A-Za-z0-9._\\-]*-web");
    private static final Pattern PROTO_VER =
            Pattern.compile("\\d{4}-\\d{2}-\\d{2}\\.[a-z0-9.\\-]*playback-v\\d+");
    private static final Pattern CLIENT_VER =
            Pattern.compile("x-ai-movie-client-version\",\\s*\"([^\"]+)\"");

    private final SecureRandom random = new SecureRandom();

    private String host = DEFAULT_HOST;
    private String linePref = "";
    private String signKey = null;
    private String buildVer = "";
    private String protoVer = "";
    private String clientVer = "1.0.0";
    private String cookie = "";
    private boolean sessionReady = false;

    // ───────────────────────── 生命周期

    @Override
    public void init(Context context, String extend) throws Exception {
        if (extend == null || extend.trim().isEmpty()) {
            return;
        }
        try {
            JSONObject ext = new JSONObject(extend);
            String h = ext.optString("host", "");
            if (!h.isEmpty()) {
                host = h.replaceAll("/+$", "");
            }
            linePref = ext.optString("line", "");
        } catch (Exception ignored) {
        }
    }

    // ───────────────────────── 首页 / 分类 / 搜索

    @Override
    public String homeContent(boolean filter) throws Exception {
        JSONArray classes = new JSONArray();
        for (String[] kind : KINDS) {
            JSONObject item = new JSONObject();
            item.put("type_id", kind[0].isEmpty() ? "all" : kind[0]);
            item.put("type_name", kind[1]);
            classes.put(item);
        }
        JSONObject result = new JSONObject();
        result.put("class", classes);

        if (filter) {
            JSONArray years = new JSONArray();
            years.put(option("全部", ""));
            int thisYear = 2026;
            try {
                thisYear = Integer.parseInt(new java.text.SimpleDateFormat("yyyy").format(new java.util.Date()));
            } catch (Exception ignored) {
            }
            for (int y = thisYear; y >= 2015; y--) {
                years.put(option(String.valueOf(y), String.valueOf(y)));
            }
            JSONArray areas = new JSONArray();
            areas.put(option("全部", ""));
            for (String area : AREAS) {
                areas.put(option(area, area));
            }

            JSONObject rows = new JSONObject();
            JSONArray filters = new JSONArray();
            filters.put(filter("year", "年份", years));
            filters.put(filter("area", "地区", areas));
            rows.put("year", filters.getJSONObject(0));
            rows.put("area", filters.getJSONObject(1));
            JSONArray list = new JSONArray();
            list.put(filters.getJSONObject(0));
            list.put(filters.getJSONObject(1));
            JSONObject all = new JSONObject();
            for (String[] kind : KINDS) {
                all.put(kind[0].isEmpty() ? "all" : kind[0], list);
            }
            result.put("filters", all);
        }
        return result.toString();
    }

    @Override
    public String homeVideoContent() throws Exception {
        try {
            Map<String, String> params = new LinkedHashMap<>();
            params.put("page", "1");
            params.put("limit", String.valueOf(PAGE_LIMIT));
            JSONObject data = api("/v1/browse/catalog", params, "GET", null);
            JSONObject out = new JSONObject();
            out.put("list", cards(data.optJSONArray("cards")));
            return out.toString();
        } catch (Exception e) {
            return "{\"list\":[]}";
        }
    }

    @Override
    public String categoryContent(String tid, String pg, boolean filter,
                                  HashMap<String, String> extend) throws Exception {
        int page = parseInt(pg, 1);
        Map<String, String> params = new LinkedHashMap<>();
        params.put("page", String.valueOf(page));
        params.put("limit", String.valueOf(PAGE_LIMIT));
        if (tid != null && !tid.isEmpty() && !"all".equals(tid)) {
            params.put("kind", tid);
        }
        if (extend != null) {
            String year = extend.get("year");
            String area = extend.get("area");
            if (year != null && !year.isEmpty()) params.put("year", year);
            if (area != null && !area.isEmpty()) params.put("area", area);
        }
        JSONObject data = api("/v1/browse/catalog", params, "GET", null);
        JSONObject out = new JSONObject();
        out.put("list", cards(data.optJSONArray("cards")));
        out.put("page", page);
        out.put("pagecount", pageCount(data, page));
        out.put("limit", PAGE_LIMIT);
        return out.toString();
    }

    @Override
    public String searchContent(String key, boolean quick, String pg) throws Exception {
        String word = key == null ? "" : key.trim();
        int page = parseInt(pg, 1);
        if (word.isEmpty()) {
            return "{\"list\":[],\"page\":1,\"pagecount\":1,\"limit\":" + PAGE_LIMIT + "}";
        }
        Map<String, String> params = new LinkedHashMap<>();
        params.put("page", String.valueOf(page));
        params.put("limit", String.valueOf(PAGE_LIMIT));
        params.put("q", word);
        JSONObject data = api("/v1/browse/catalog", params, "GET", null);
        JSONObject out = new JSONObject();
        out.put("list", cards(data.optJSONArray("cards")));
        out.put("page", page);
        out.put("pagecount", pageCount(data, page));
        out.put("limit", PAGE_LIMIT);
        return out.toString();
    }

    // ───────────────────────── 详情 / 剧集

    @Override
    public String detailContent(List<String> ids) throws Exception {
        String vid = ids.get(0);
        JSONObject detail = api("/v1/catalog/" + vid + "/detail", null, "GET", null);
        List<JSONObject> episodes = episodes(vid);
        if (episodes.isEmpty()) {
            throw new IllegalStateException("该片暂无可用集数");
        }
        StringBuilder playUrl = new StringBuilder();
        for (JSONObject ep : episodes) {
            String token = ep.optString("token", "");
            if (token.isEmpty()) continue;
            String name = ep.optString("title", "");
            if (name.isEmpty()) name = "第" + ep.optInt("number", 0) + "集";
            if (playUrl.length() > 0) playUrl.append('#');
            playUrl.append(safe(name)).append('$').append(token);
        }
        if (playUrl.length() == 0) {
            throw new IllegalStateException("剧集缺少播放 token");
        }

        JSONObject item = new JSONObject();
        item.put("vod_id", vid);
        item.put("vod_name", detail.optString("title", ""));
        item.put("vod_pic", firstNonEmpty(detail.optString("poster_url", ""), detail.optString("backdrop_url", "")));
        item.put("vod_remarks", firstNonEmpty(detail.optString("remarks", ""), detail.optString("episode_progress_text", "")));
        item.put("vod_year", detail.optString("year", ""));
        item.put("vod_area", detail.optString("area", ""));
        item.put("type_name", join(detail.optJSONArray("genres"), 3));
        item.put("vod_director", join(detail.optJSONArray("directors"), 99));
        item.put("vod_actor", join(detail.optJSONArray("actors"), 8));
        item.put("vod_content", detail.optString("description", ""));
        item.put("vod_play_from", "看剧AI");
        item.put("vod_play_url", playUrl.toString());

        JSONArray list = new JSONArray();
        list.put(item);
        JSONObject out = new JSONObject();
        out.put("list", list);
        return out.toString();
    }

    private List<JSONObject> episodes(String vid) throws Exception {
        List<JSONObject> all = new ArrayList<>();
        int offset = 0;
        while (true) {
            Map<String, String> params = new LinkedHashMap<>();
            params.put("limit", "48");
            params.put("offset", String.valueOf(offset));
            JSONObject data = api("/v1/catalog/" + vid + "/episodes", params, "GET", null);
            JSONArray batch = data.optJSONArray("episodes");
            if (batch == null || batch.length() == 0) break;
            for (int i = 0; i < batch.length(); i++) all.add(batch.getJSONObject(i));
            JSONObject pg = data.optJSONObject("episode_pagination");
            if (pg == null || !pg.optBoolean("has_more")) break;
            offset = pg.optInt("offset", offset) + pg.optInt("returned_count", batch.length());
        }
        return all;
    }

    // ───────────────────────── 播放

    @Override
    public String playerContent(String flag, String id, List<String> vipFlags) throws Exception {
        String ticket = id == null ? "" : id.trim();
        if (ticket.isEmpty()) return "{\"parse\":0,\"msg\":\"缺少播放标识\"}";

        JSONObject resolved = api("/v1/playback/resolve/" + ticket,
                Collections.singletonMap("view", "compact"), "GET", null);
        JSONArray options = resolved.optJSONArray("line_options");
        List<JSONObject> usable = new ArrayList<>();
        if (options != null) {
            for (int i = 0; i < options.length(); i++) {
                JSONObject o = options.optJSONObject(i);
                if (o == null) continue;
                String url = o.optString("url", "");
                if (url.isEmpty()) continue;
                if (o.optInt("minimum_user_level", 0) > 0) continue;
                usable.add(o);
            }
        }
        if (usable.isEmpty()) return "{\"parse\":0,\"msg\":\"该集暂无可用线路\"}";

        Collections.sort(usable, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return rank(a) - rank(b);
            }
        });

        String lastError = "";
        int tried = 0;
        for (JSONObject o : usable) {
            if (tried++ >= MAX_LINE_TRIES) break;
            try {
                String media = resolveLine(o.optString("url", ""), 0);
                if (media == null || media.isEmpty()) continue;
                JSONObject out = new JSONObject();
                out.put("parse", 0);
                out.put("url", media);
                JSONObject header = new JSONObject();
                header.put("User-Agent", UA);
                header.put("Referer", host + "/");
                out.put("header", header);
                if (media.split("\\?")[0].toLowerCase().contains(".m3u8")) {
                    out.put("format", "application/x-mpegURL");
                }
                return out.toString();
            } catch (Exception e) {
                lastError = e.getMessage() == null ? "" : e.getMessage();
            }
        }
        JSONObject fail = new JSONObject();
        fail.put("parse", 0);
        fail.put("msg", "线路暂不可用" + (lastError.isEmpty() ? "" : "：" + lastError));
        return fail.toString();
    }

    private int rank(JSONObject o) {
        int score = 0;
        if (!o.optString("url", "").startsWith("resolve://")) score -= 10;
        if (o.optBoolean("selected")) score -= 3;
        if (!linePref.isEmpty()) {
            String label = (o.optString("label", "") + " " + o.optString("provider_id", "")).toLowerCase();
            if (label.contains(linePref.toLowerCase())) score -= 100;
        }
        return score;
    }

    private String resolveLine(String ref, int depth) throws Exception {
        if (ref == null || ref.isEmpty()) return "";
        if (!ref.startsWith("resolve://")) return ref;
        if (depth >= 2) return "";
        JSONObject payload = new JSONObject();
        payload.put("ticket", ref.replace("resolve://", ""));
        JSONObject data = api("/v1/playback/resolve-line",
                Collections.singletonMap("view", "compact"), "POST", payload);
        JSONObject line = data.optJSONObject("line");
        String next = line == null ? "" : line.optString("url", "");
        return resolveLine(next, depth + 1);
    }

    // ───────────────────────── 签名与请求

    private JSONObject api(String path, Map<String, String> params, String method, JSONObject payload)
            throws Exception {
        ensureSigning();

        StringBuilder query = new StringBuilder();
        if (params != null) {
            for (Map.Entry<String, String> e : params.entrySet()) {
                if (e.getValue() == null || e.getValue().isEmpty()) continue;
                if (query.length() > 0) query.append('&');
                query.append(URLEncoder.encode(e.getKey(), "UTF-8"))
                        .append('=')
                        .append(URLEncoder.encode(e.getValue(), "UTF-8"));
            }
        }
        String target = query.length() == 0 ? path : path + "?" + query;

        String body = payload == null ? null : payload.toString();
        Resp resp = signedRequest(target, method, body);

        if (resp.code == 401 && !sessionReady
                && (resp.text.contains("session") || resp.text.contains("login_required"))) {
            if (ensureSession()) {
                resp = signedRequest(target, method, body);
            }
        }
        if (resp.code < 200 || resp.code >= 300) {
            throw new IllegalStateException("HTTP " + resp.code + " @" + target + " "
                    + resp.text.substring(0, Math.min(100, resp.text.length())));
        }
        try {
            return new JSONObject(resp.text);
        } catch (Exception e) {
            throw new IllegalStateException("响应不是 JSON @" + target);
        }
    }

    private Resp signedRequest(String target, String method, String body) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        String nonce = nonce();
        String canonical = method + "\n" + target + "\n" + ts + "\n" + nonce;
        String signature = hmac(signKey, canonical);

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("User-Agent", UA);
        headers.put("Accept", "application/json");
        headers.put("Referer", host + "/");
        headers.put("Origin", host);
        headers.put("x-ai-movie-timestamp", ts);
        headers.put("x-ai-movie-nonce", nonce);
        headers.put("x-ai-movie-signature", signature);
        headers.put("x-ai-movie-client-name", "dianyingtiantang-frontend");
        headers.put("x-ai-movie-client-version", clientVer);
        if (!buildVer.isEmpty()) headers.put("x-ai-movie-build-version", buildVer);
        if (!protoVer.isEmpty()) headers.put("x-ai-movie-protocol-version", protoVer);
        if (body != null) headers.put("Content-Type", "application/json");
        return request(host + target, headers, method, body);
    }

    private boolean ensureSession() {
        if (sessionReady) return true;
        try {
            String target = "/v1/users/anonymous";
            String ts = String.valueOf(System.currentTimeMillis());
            String nonce = nonce();
            String sig = hmac(signKey, "POST\n" + target + "\n" + ts + "\n" + nonce);
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("User-Agent", UA);
            headers.put("Accept", "application/json");
            headers.put("Referer", host + "/");
            headers.put("Origin", host);
            headers.put("Content-Type", "application/json");
            headers.put("x-ai-movie-timestamp", ts);
            headers.put("x-ai-movie-nonce", nonce);
            headers.put("x-ai-movie-signature", sig);
            headers.put("x-ai-movie-client-name", "dianyingtiantang-frontend");
            headers.put("x-ai-movie-client-version", clientVer);
            if (!buildVer.isEmpty()) headers.put("x-ai-movie-build-version", buildVer);
            if (!protoVer.isEmpty()) headers.put("x-ai-movie-protocol-version", protoVer);

            String body = "{\"anonymous_id\":\"web_" + nonce() + "\"}";
            Resp resp = request(host + target, headers, "POST", body);
            sessionReady = resp.code >= 200 && resp.code < 300;
        } catch (Exception e) {
            sessionReady = false;
        }
        return sessionReady;
    }

    private void ensureSigning() throws Exception {
        if (signKey != null) return;
        Resp home = request(host + "/", new LinkedHashMap<String, String>() {{
            put("User-Agent", UA);
        }}, "GET", null);
        Matcher m = RUNTIME_JS.matcher(home.text);
        String js = "";
        if (m.find()) {
            Resp runtime = request(host + m.group(), new LinkedHashMap<String, String>() {{
                put("User-Agent", UA);
            }}, "GET", null);
            js = runtime.text;
        }
        if (js.isEmpty()) throw new IllegalStateException("取不到站点脚本，无法初始化签名");

        Matcher km = SIGN_KEY.matcher(js);
        if (!km.find()) throw new IllegalStateException("未找到签名密钥（站点可能改版）");
        signKey = km.group(1);

        Matcher bm = BUILD_VER.matcher(js);
        if (bm.find()) buildVer = bm.group();
        Matcher pm = PROTO_VER.matcher(js);
        if (pm.find()) protoVer = pm.group();
        Matcher vm = CLIENT_VER.matcher(js);
        if (vm.find()) clientVer = vm.group(1);
    }

    // ───────────────────────── 基础工具

    private static class Resp {
        final int code;
        final String text;

        Resp(int code, String text) {
            this.code = code;
            this.text = text;
        }
    }

    private Resp request(String url, Map<String, String> headers, String method, String body) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("Accept-Encoding", "identity");
        for (Map.Entry<String, String> e : headers.entrySet()) {
            conn.setRequestProperty(e.getKey(), e.getValue());
        }
        if (!cookie.isEmpty()) {
            conn.setRequestProperty("Cookie", cookie);
        }
        if (body != null) {
            conn.setDoOutput(true);
            OutputStream os = conn.getOutputStream();
            os.write(body.getBytes("UTF-8"));
            os.flush();
            os.close();
        }

        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        String text = readAll(is);
        String setCookie = conn.getHeaderField("Set-Cookie");
        if (setCookie != null && !setCookie.isEmpty()) {
            cookie = setCookie.split(";")[0];
        }
        conn.disconnect();
        return new Resp(code, text);
    }

    private static String readAll(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        is.close();
        return bos.toString("UTF-8");
    }

    private String nonce() {
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String hmac(String key, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes("UTF-8"), "HmacSHA256"));
        byte[] out = mac.doFinal(data.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : out) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static JSONArray cards(JSONArray source) {
        JSONArray out = new JSONArray();
        if (source == null) return out;
        for (int i = 0; i < source.length(); i++) {
            JSONObject c = source.optJSONObject(i);
            if (c == null) continue;
            String id = c.optString("id", "");
            if (id.isEmpty()) continue;
            JSONObject item = new JSONObject();
            try {
                item.put("vod_id", id);
                item.put("vod_name", c.optString("title", ""));
                item.put("vod_pic", firstNonEmpty(c.optString("poster_url", ""), c.optString("backdrop_url", "")));
                item.put("vod_remarks", c.optString("remarks", ""));
                item.put("vod_year", c.optString("year", ""));
                item.put("vod_area", c.optString("area", ""));
                item.put("type_name", c.optString("content_kind", ""));
            } catch (Exception ignored) {
            }
            out.put(item);
        }
        return out;
    }

    private static int pageCount(JSONObject data, int page) {
        JSONObject pg = data.optJSONObject("pagination");
        if (pg != null) {
            int total = pg.optInt("total", 0);
            int limit = pg.optInt("limit", PAGE_LIMIT);
            if (total > 0 && limit > 0) return Math.max(page, Math.min((total + limit - 1) / limit, 50));
            if (pg.optBoolean("has_more")) return page + 1;
        }
        return Math.max(1, page);
    }

    private static JSONObject option(String name, String value) {
        JSONObject o = new JSONObject();
        try {
            o.put("n", name);
            o.put("v", value);
        } catch (Exception ignored) {
        }
        return o;
    }

    private static JSONObject filter(String key, String name, JSONArray values) {
        JSONObject f = new JSONObject();
        try {
            f.put("key", key);
            f.put("name", name);
            f.put("init", "");
            f.put("value", values);
        } catch (Exception ignored) {
        }
        return f;
    }

    private static String join(JSONArray array, int limit) {
        if (array == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < array.length() && i < limit; i++) {
            if (sb.length() > 0) sb.append(", ");
            sb.append(array.optString(i, ""));
        }
        return sb.toString();
    }

    private static String firstNonEmpty(String a, String b) {
        return a == null || a.isEmpty() ? (b == null ? "" : b) : a;
    }

    private static String safe(String text) {
        String s = text == null ? "" : text.replace("$", "＄").replace("#", "＃").trim();
        return s.isEmpty() ? "正片" : s;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return Integer.parseInt(value);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String md5(String text) throws Exception {
        MessageDigest md = MessageDigest.getInstance("MD5");
        byte[] out = md.digest(text.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : out) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
