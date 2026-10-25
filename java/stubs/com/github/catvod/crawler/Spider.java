package com.github.catvod.crawler;

import android.content.Context;
import java.util.HashMap;
import java.util.List;

// 编译期最小桩：仅供 java/BUILD.md 步骤 1 本地编译 Kanju.java / Proxy.java 时解析基类符号。
// 真实 Spider 基类由宿主（CatVod / FongMi）提供；本桩不得打进 spider.jar，也不得用于运行。
// 方法均给默认实现（而非抽象方法）：Kanju 以 @Override 覆盖它们；
// Proxy 同样继承 Spider 但不覆盖任何方法，若此处用抽象方法，Proxy 将无法编译。
public abstract class Spider {

    public void init(Context context, String extend) throws Exception {
    }

    public String homeContent(boolean filter) throws Exception {
        return "";
    }

    public String homeVideoContent() throws Exception {
        return "";
    }

    public String categoryContent(String tid, String pg, boolean filter,
            HashMap<String, String> extend) throws Exception {
        return "";
    }

    public String searchContent(String key, boolean quick, String pg) throws Exception {
        return "";
    }

    public String detailContent(List<String> ids) throws Exception {
        return "";
    }

    public String playerContent(String flag, String id, List<String> vipFlags) throws Exception {
        return "";
    }
}
