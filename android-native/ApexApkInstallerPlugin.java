package com.apexpump.station;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.net.URLDecoder;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/**
 * نصب‌کنندهٔ بروزرسانی (APEX Pump Station)
 * ---------------------------------------------------------------------------
 * فایلِ APKِ دانلودشده را مستقیم به «نصب‌کنندهٔ اندروید» می‌دهد (content:// از
 * FileProvider خودِ برنامه + اجازهٔ خواندنِ موقت). پیش از آن بررسی می‌کند:
 *   • اجازهٔ «نصب برنامه‌های ناشناس» داده شده باشد (وگرنه صفحهٔ همان اجازه باز می‌شود)
 *   • فایل مالِ همین برنامه باشد (همان packageName)
 *   • با همان کلیدِ امضای نسخهٔ نصب‌شده امضا شده باشد (وگرنه اندروید «App not installed» می‌دهد)
 *   • نسخه‌اش از نسخهٔ نصب‌شده پایین‌تر نباشد
 * نتیجه همیشه یک پاسخِ روشن است؛ هیچ حدسی دربارهٔ «باز شد یا نه» در کار نیست.
 */
@CapacitorPlugin(name = "ApexApkInstaller")
public class ApexApkInstallerPlugin extends Plugin {

    private static final String APK_MIME = "application/vnd.android.package-archive";

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    private boolean openUnknownSourcesSettings() {
        Context ctx = getContext();
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + ctx.getPackageName()));
            } else {
                i = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                Intent i2 = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + ctx.getPackageName()));
                i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i2);
                return true;
            } catch (Exception e2) {
                return false;
            }
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", canInstallPackages());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("opened", openUnknownSourcesSettings());
        call.resolve(r);
    }

    @PluginMethod
    public void install(PluginCall call) {
        Context ctx = getContext();
        String path = call.getString("path", "");
        if (path == null) path = "";
        if (path.startsWith("file://")) path = path.substring(7);
        try { path = URLDecoder.decode(path.replace("+", "%2B"), "UTF-8"); } catch (Exception ignored) { }

        JSObject r = new JSObject();
        File f = new File(path);
        if (path.length() == 0 || !f.isFile() || f.length() < 1024) {
            r.put("started", false);
            r.put("reason", "file-missing");
            r.put("path", path);
            call.resolve(r);
            return;
        }

        PackageManager pm = ctx.getPackageManager();

        // ── بررسیِ فایل در برابرِ نسخهٔ نصب‌شده ──
        try {
            int flags = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                    ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo arch = pm.getPackageArchiveInfo(f.getAbsolutePath(), flags);
            if (arch == null) {
                r.put("started", false);
                r.put("reason", "invalid-apk");
                call.resolve(r);
                return;
            }
            if (arch.applicationInfo != null) {
                arch.applicationInfo.sourceDir = f.getAbsolutePath();
                arch.applicationInfo.publicSourceDir = f.getAbsolutePath();
            }
            if (arch.packageName != null && !arch.packageName.equals(ctx.getPackageName())) {
                r.put("started", false);
                r.put("reason", "wrong-package");
                r.put("apkPackage", arch.packageName);
                call.resolve(r);
                return;
            }
            PackageInfo cur = pm.getPackageInfo(ctx.getPackageName(), flags);
            long curCode = versionCodeOf(cur);
            long newCode = versionCodeOf(arch);
            r.put("installedCode", curCode);
            r.put("apkCode", newCode);
            r.put("apkVersion", arch.versionName == null ? "" : arch.versionName);
            if (newCode > 0 && curCode > 0 && newCode < curCode) {
                r.put("started", false);
                r.put("reason", "older-version");
                call.resolve(r);
                return;
            }
            Set<String> a = certSet(cur);
            Set<String> b = certSet(arch);
            // فقط وقتی هر دو طرف معلوم‌اند قضاوت می‌کنیم؛ نامعلوم = اجازه به نصب‌کننده
            if (!a.isEmpty() && !b.isEmpty() && !a.equals(b)) {
                r.put("started", false);
                r.put("reason", "signature-mismatch");
                call.resolve(r);
                return;
            }
        } catch (Exception ignored) {
            // بررسی ممکن نشد → تصمیم با خودِ نصب‌کنندهٔ اندروید
        }

        // ── اجازهٔ «نصب برنامه‌های ناشناس» ──
        if (!canInstallPackages()) {
            r.put("started", false);
            r.put("reason", "needs-permission");
            r.put("settingsOpened", openUnknownSourcesSettings());
            call.resolve(r);
            return;
        }

        // ── بازکردنِ نصب‌کننده ──
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                uri = Uri.fromFile(f);
            }
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            r.put("started", true);
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            r.put("started", false);
            r.put("reason", "start-failed");
            r.put("error", String.valueOf(e.getMessage()));
            call.resolve(r);
        }
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo p) {
        if (p == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return p.getLongVersionCode();
        return p.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static Set<String> certSet(PackageInfo p) {
        Set<String> out = new HashSet<String>();
        if (p == null) return out;
        Signature[] sigs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo si = p.signingInfo;
            if (si != null) {
                sigs = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
            }
        }
        if (sigs == null || sigs.length == 0) sigs = p.signatures;
        if (sigs == null) return out;
        for (Signature s : sigs) {
            if (s == null) continue;
            try {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] d = md.digest(s.toByteArray());
                StringBuilder sb = new StringBuilder();
                for (byte x : d) sb.append(String.format("%02x", x));
                out.add(sb.toString());
            } catch (Exception ignored) { }
        }
        return out;
    }
}
