package devline.audio.qa;

import java.util.List;

/** Keep Chromium active on an owned background desktop without changing the shipped host. */
public final class CefQaAgent {
    @SuppressWarnings("unchecked")
    public static void premain(String ignored) throws Exception {
        String desktop = System.getenv("DEVLINE_NATIVE_QA_DESKTOP");
        if (desktop == null || !desktop.startsWith("DevLine-QA-")) throw new IllegalStateException("Owned QA desktop required");
        var defaults = Class.forName("me.friwi.jcefmaven.CefAppBuilder").getDeclaredField("DEFAULT_JCEF_ARGS");
        defaults.setAccessible(true);
        ((List<String>) defaults.get(null)).addAll(List.of("--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-features=CalculateNativeWinOcclusion", "--enable-logging=stderr"));
    }
}
