/**
 * demo-mode.js — نسخهٔ آزمایشیِ یک‌هفته‌ای (APEX Pump Station) — فقط یک‌بار روی هر دستگاه
 * ---------------------------------------------------------------------------
 * لایهٔ کاملاً افزودنی و مستقل: فقط از طریقِ DOM با صفحهٔ ورود و برنامه تعامل می‌کند.
 *
 * قرارداد امنیتی (صادقانه):
 *   • «مقاوم در برابرِ تغییرِ ساعتِ سیستم»: بله — با «آخرین‌زمانِ دیده‌شدهٔ یکنواخت» (seen).
 *     effNow = max(now, seen) و seen فقط جلو می‌رود؛ پس بردنِ ساعت به عقب مهلت را تمدید
 *     نمی‌کند و بردن به جلو فقط زودتر منقضی می‌کند.
 *   • «تشخیصِ دستکاریِ فایلِ Local»: بله — امضای checksum؛ اگر مقادیر دستکاری شوند،
 *     نسخهٔ آزمایشی مثلِ «منقضی» رفتار می‌کند (اطلاعاتِ آزمایشی پاک می‌شود).
 *   • «یک‌بار مصرف»: با شروعِ نسخهٔ آزمایشی، نشانهٔ «استفاده‌شده» هم در localStorage
 *     (__jouya_demo_used) و هم در IndexedDB (apexps_demo_mark / m / used) ثبت می‌شود؛
 *     اگر هرکدام موجود باشد، دکمهٔ مهمان نمایش داده نمی‌شود و شروعِ دوباره رد می‌شود.
 *     (پاک‌کردنِ کاملِ اطلاعاتِ مرورگر/نصبِ مجدد را به‌صورتِ محلی نمی‌توان کاملاً بست.)
 *
 * پایانِ مهلت (یا دستکاری): پوششِ «در حال پاک‌کردن…» ← حذفِ همهٔ کلیدهای localStorageِ
 * همین برنامه به‌جز دو نشانهٔ «استفاده‌شده» و «پیامِ پایان» ← پاک‌شدنِ sessionStorage ←
 * انتظار برای ثبتِ قطعی در IndexedDB (JouyaStore.whenSaved) و پاک‌کردنِ مخزن‌های جانبی
 * (JouyaStore.wipeExtras) ← بارگذاریِ دوباره و نمایشِ کارتِ قفل.
 * اگر حسابِ واقعی روی دستگاه باشد، هیچ اطلاعاتی پاک نمی‌شود؛ فقط حالتِ مهمان برداشته می‌شود.
 *
 * جداسازی از دادهٔ واقعی: دکمهٔ مهمان فقط وقتی نمایش داده می‌شود که هیچ حسابِ واقعی روی این
 * دستگاه نباشد (jouya_user_account خالی). Demo هرگز به ابر Login نمی‌کند.
 */
(function () {
    'use strict';

    var DURATION_MS = 7 * 24 * 60 * 60 * 1000;   // ۷ روز
    var SALT = 'JOUYA::demo::v1::9f3a';          // نمکِ امضا (فقط سختی‌افزایی)
    var K_STATE = '__jouya_demo_state';          // { start, seen, sig }
    var K_USED = '__jouya_demo_used';            // { at, sig } — نشانهٔ یک‌بار مصرف
    var K_END = '__jouya_demo_end_msg';          // '1' — پس از پاک‌سازی، کارتِ قفل نمایش داده شود
    var K_ACCOUNT = 'jouya_user_account';        // حسابِ واقعی (فقط برای gating خوانده می‌شود)
    var IDB_NAME = 'apexps_demo_mark', IDB_STORE = 'm', IDB_KEY = 'used';   // جدا از Store Manager

    var MSG_USED = 'نسخهٔ آزمایشی روی این دستگاه یک‌بار استفاده شده است و دوباره فعال نمی‌شود؛ برای ادامه لطفاً حساب بسازید و کد فعال‌سازی را وارد کنید.';
    var MSG_END = 'یک هفته استفادهٔ آزمایشی تمام شد و اطلاعات آزمایشی این دستگاه پاک شد. نسخهٔ آزمایشی دوباره روی این دستگاه فعال نمی‌شود؛ برای ادامه لطفاً حساب بسازید و کد فعال‌سازی را وارد کنید.';

    function _now() { return Date.now(); }

    // hash سادهٔ رشته (djb2) — برای امضای مقادیر
    function _hash(str) {
        var h = 5381, i = str.length;
        while (i) { h = (h * 33) ^ str.charCodeAt(--i); }
        return (h >>> 0).toString(36);
    }
    function _sig(start, seen) { return _hash(String(start) + '|' + String(seen) + '|' + SALT); }
    function _usedSig(at) { return _hash('used|' + String(at) + '|' + SALT); }

    function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function _lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    // پیامِ کوتاه: روی صفحهٔ ورود با پیامِ خودِ صفحه، وگرنه alert
    function _alert(msg) {
        try {
            if (window.AuthUI && typeof window.AuthUI.showAlert === 'function' && document.getElementById('auth-screen-overlay')) {
                window.AuthUI.showAlert('warning', msg);
                return;
            }
        } catch (e) {}
        try { alert(msg); } catch (e) {}
    }

    // ── نشانهٔ «استفاده‌شده» در IndexedDB (یک اتصال، نوشتن‌ها پشتِ‌سرِهم) ──────────
    var _idbP = null, _idbChain = Promise.resolve();
    var _usedIdb = false, _idbChecked = false;
    function _idbOpen() {
        if (_idbP) return _idbP;
        _idbP = new Promise(function (res, rej) {
            var t = setTimeout(function () { rej(new Error('timeout')); }, 4000);
            try {
                if (typeof indexedDB === 'undefined' || !indexedDB) { clearTimeout(t); rej(new Error('no idb')); return; }
                var r = indexedDB.open(IDB_NAME, 1);
                r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE); };
                r.onsuccess = function () { clearTimeout(t); res(r.result); };
                r.onerror = function () { clearTimeout(t); rej(r.error || new Error('open failed')); };
            } catch (e) { clearTimeout(t); rej(e); }
        });
        _idbP.catch(function () { _idbP = null; });
        return _idbP;
    }
    function _idbGetUsed() {
        return _idbOpen().then(function (d) {
            return new Promise(function (res) {
                try {
                    var tx = d.transaction(IDB_STORE, 'readonly'), rq = tx.objectStore(IDB_STORE).get(IDB_KEY);
                    tx.oncomplete = function () { res(rq.result || null); };
                    tx.onerror = tx.onabort = function () { res(null); };
                } catch (e) { res(null); }
            });
        });
    }
    function _idbSetUsed(rec) {
        _idbChain = _idbChain.then(function () {
            return _idbOpen().then(function (d) {
                return new Promise(function (res) {
                    try {
                        var tx = d.transaction(IDB_STORE, 'readwrite');
                        tx.objectStore(IDB_STORE).put(rec, IDB_KEY);
                        tx.oncomplete = function () { _usedIdb = true; res(true); };
                        tx.onerror = tx.onabort = function () { res(false); };
                    } catch (e) { res(false); }
                });
            });
        }).catch(function () { return false; });
        return _idbChain;
    }

    function _usedLs() { return !!_lsGet(K_USED); }
    function _isUsed() { return _usedLs() || _usedIdb; }
    // نشانهٔ «استفاده‌شده» در هر دو جا ثبت می‌شود (اگر یکی موجود است، همان تاریخ حفظ می‌شود)
    function _markUsed() {
        var rec = null;
        try { rec = JSON.parse(_lsGet(K_USED) || 'null'); } catch (e) { rec = null; }
        if (!rec || typeof rec.at !== 'number') { var at = _now(); rec = { at: at, sig: _usedSig(at) }; }
        _lsSet(K_USED, JSON.stringify(rec));
        return _idbSetUsed(rec);
    }

    function _readState() {
        var raw = _lsGet(K_STATE);
        if (!raw) return null;
        try {
            var o = JSON.parse(raw);
            if (!o || typeof o.start !== 'number' || typeof o.seen !== 'number' || typeof o.sig !== 'string') {
                return { tampered: true, start: 0, seen: 0 };
            }
            if (o.sig !== _sig(o.start, o.seen)) return { tampered: true, start: o.start, seen: o.seen };
            return { tampered: false, start: o.start, seen: o.seen };
        } catch (e) { return { tampered: true, start: 0, seen: 0 }; }
    }

    function _writeState(start, seen) {
        _lsSet(K_STATE, JSON.stringify({ start: start, seen: seen, sig: _sig(start, seen) }));
    }

    function _hasRealAccount() {
        try { var a = JSON.parse(_lsGet(K_ACCOUNT) || 'null'); return !!(a && a.email); }
        catch (e) { return false; }
    }

    // وضعیتِ فعلیِ Demo — با به‌روزرسانیِ یکنواختِ seen (ضدِ عقب‌بردنِ ساعت).
    function status() {
        var st = _readState();
        if (!st) return { active: false, expired: false, tampered: false, remainingMs: DURATION_MS };
        if (st.tampered) return { active: true, expired: true, tampered: true, remainingMs: 0 };
        var now = _now();
        var effNow = Math.max(now, st.seen);   // یکنواخت: هرگز عقب نمی‌رود
        if (effNow !== st.seen) _writeState(st.start, effNow);   // فقط وقتی جلو رفته persist کن
        var elapsed = effNow - st.start;
        var remaining = DURATION_MS - elapsed;
        return {
            active: true,
            expired: remaining <= 0,
            tampered: false,
            remainingMs: remaining > 0 ? remaining : 0,
            start: st.start,
            seen: effNow
        };
    }

    function isActive() { var st = _readState(); return !!st; }

    // شروعِ Demo (فقط اگر حسابِ واقعی نباشد و این دستگاه قبلاً از نسخهٔ آزمایشی استفاده نکرده باشد)
    var _starting = false;
    function start() {
        if (_hasRealAccount()) {
            _alert('برای نسخهٔ آزمایشی از دستگاهی بدونِ حسابِ ثبت‌شده استفاده کنید تا داده‌های واقعی با آزمایشی مخلوط نشود.');
            return false;
        }
        if (isActive()) { _afterStart(); return true; }   // قبلاً شروع شده — فقط ادامه بده
        if (_usedLs()) { _alert(MSG_USED); _hideButton(); return false; }
        if (_starting) return false;
        _starting = true;
        // نشانهٔ IndexedDB هم بررسی می‌شود (اگر در دسترس نباشد، فقط نشانهٔ localStorage ملاک است)
        _idbGetUsed().catch(function () { return null; }).then(function (rec) {
            _starting = false;
            if (rec) { _usedIdb = true; _alert(MSG_USED); _hideButton(); return; }
            if (_usedLs() || isActive()) { if (isActive()) _afterStart(); return; }
            var t = _now();
            _writeState(t, t);
            _markUsed();
            try { if (typeof JouyaDemo._cloudHook === 'function') JouyaDemo._cloudHook('start', t); } catch (e) {}
            _afterStart();
        });
        return true;
    }

    function _afterStart() {
        var s = status();
        if (s.expired) { _expire(); return; }
        _revealApp();
        _renderBadge();
        _scheduleChecks();
    }

    // ---- نمایشِ برنامه (هم‌رفتارِ closeAuthAndStart، بدونِ دست‌زدن به auth-system) ----
    function _revealApp() {
        var ov = document.getElementById('auth-screen-overlay');
        if (ov) { ov.style.transition = 'opacity 0.35s'; ov.style.opacity = '0'; setTimeout(function () { if (ov && ov.parentNode) ov.remove(); }, 380); }
        try { document.body.style.overflow = ''; } catch (e) {}
    }

    // ---- نشانِ «نسخهٔ آزمایشی — X روز/ساعت باقی‌مانده» ----
    function _fmtRemaining(ms) {
        if (ms <= 0) return 'پایان‌یافته';
        var totalMin = Math.floor(ms / 60000);
        var d = Math.floor(totalMin / (60 * 24));
        var h = Math.floor((totalMin - d * 60 * 24) / 60);
        if (d > 0) return d + ' روز و ' + h + ' ساعت';
        var m = totalMin - h * 60;
        return h + ' ساعت و ' + m + ' دقیقه';
    }
    function _renderBadge() {
        var s = status();
        if (!s.active) return;
        var el = document.getElementById('jouya-demo-badge');
        if (!el) {
            el = document.createElement('div');
            el.id = 'jouya-demo-badge';
            el.style.cssText = 'position:fixed;bottom:14px;inset-inline-start:14px;z-index:99990;background:#1e3a5f;color:#fff;' +
                'padding:8px 12px;border-radius:10px;font-family:inherit;font-size:12.5px;font-weight:700;' +
                'box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;gap:10px;';
            document.body.appendChild(el);
        }
        el.innerHTML =
            '<span><i class="fas fa-hourglass-half"></i> نسخهٔ آزمایشی — باقی‌مانده: ' + _fmtRemaining(s.remainingMs) + '</span>' +
            '<button id="jouya-demo-exit-btn" type="button" title="خروج از نسخهٔ آزمایشی و ساخت حساب واقعی" ' +
                'style="background:#fff;color:#1e3a5f;border:none;border-radius:8px;padding:5px 10px;font-family:inherit;font-weight:700;font-size:11.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">' +
                '<i class="fas fa-user-plus"></i> ساخت حساب / فعال‌سازی</button>';
        var xb = document.getElementById('jouya-demo-exit-btn');
        if (xb) xb.onclick = function () { _exitDemoToRegister(); };
    }

    // خروجِ امنِ Demo و رفتن به «ثبت‌نامِ واقعیِ موجود» (بدونِ تغییر نسبت به قبل).
    function _exitDemoToRegister() {
        _lsDel(K_STATE);
        var DEMO_DATA_KEYS = ['persons', 'products', 'transactions', 'expenses', 'cashboxes', 'returns',
            'services', 'warehouses', 'warehouseTransfers', 'cashboxTransactions', 'meters', 'meterReadings',
            'jouya-currencies', 'jouya-exchange-rates', 'jouya-reference-rates',
            'dashboardStats', 'activeWarehouseId', 'settings'];
        DEMO_DATA_KEYS.forEach(function (k) { _lsDel(k); });
        _lsSet('__jouya_demo_goto_register', '1');
        var b = document.getElementById('jouya-demo-badge'); if (b) b.remove();
        var lk = document.getElementById('jouya-demo-lock'); if (lk) lk.remove();
        try { (window.JouyaStore && JouyaStore.reloadSafe ? JouyaStore.reloadSafe() : location.reload()); } catch (e) {}
    }
    if (typeof window !== 'undefined') window.__jouyaDemoExit = _exitDemoToRegister;

    // ---- پایانِ مهلت / دستکاری: پاک‌کردنِ اطلاعاتِ آزمایشی و بارگذاریِ دوباره ----
    var _wiping = false;
    function _expire() {
        if (_wiping) return;
        if (_timer) { clearInterval(_timer); _timer = null; }
        var b = document.getElementById('jouya-demo-badge'); if (b) b.remove();
        // حسابِ واقعی روی دستگاه ⇒ هیچ اطلاعاتی پاک نمی‌شود؛ فقط حالتِ مهمان برداشته می‌شود
        if (_hasRealAccount()) { _lsDel(K_STATE); _markUsed(); return; }
        _wiping = true;
        _showCover();
        var markP = _markUsed();
        var wait = function (p, ms) { return Promise.race([Promise.resolve(p).catch(function () {}), new Promise(function (r) { setTimeout(r, ms); })]); };
        wait(markP, 4000).then(function () {
            var keep = {}; keep[K_USED] = 1; keep[K_END] = 1;
            var keys = [], i, n = 0;
            try { n = localStorage.length; } catch (e) { n = 0; }
            for (i = 0; i < n; i++) { try { var k = localStorage.key(i); if (k != null) keys.push(k); } catch (e) {} }
            keys.forEach(function (k) { if (!keep[k]) _lsDel(k); });
            try { sessionStorage.clear(); } catch (e) {}
            var JS = window.JouyaStore;
            return wait(JS && typeof JS.whenSaved === 'function' ? JS.whenSaved() : null, 10000).then(function () {
                return wait(JS && typeof JS.wipeExtras === 'function' ? JS.wipeExtras() : null, 6000);
            });
        }).then(function () {
            _lsSet(K_END, '1');
            try { location.reload(); } catch (e) {}
        });
    }

    function _showCover() {
        try { document.body.style.overflow = 'hidden'; } catch (e) {}
        if (document.getElementById('jouya-demo-wipe')) return;
        var ov = document.createElement('div');
        ov.id = 'jouya-demo-wipe';
        ov.style.cssText = 'position:fixed;inset:0;top:0;right:0;bottom:0;left:0;z-index:2147483500;background:rgba(15,23,42,.97);display:flex;align-items:center;' +
            'justify-content:center;font-family:inherit;color:#e2e8f0;padding:24px;direction:rtl;text-align:center;';
        ov.innerHTML = '<div><div style="font-size:40px;color:#f59e0b;margin-bottom:14px;"><i class="fas fa-circle-notch fa-spin"></i></div>' +
            '<div style="font-size:15px;font-weight:700;line-height:2;">مهلت نسخهٔ آزمایشی تمام شد — در حال پاک‌کردن اطلاعات آزمایشی…</div></div>';
        document.body.appendChild(ov);
    }

    // ---- کارتِ قفل پس از پاک‌سازی ----
    function _lock() {
        try { document.body.style.overflow = 'hidden'; } catch (e) {}
        if (document.getElementById('jouya-demo-lock')) return;
        var ov = document.createElement('div');
        ov.id = 'jouya-demo-lock';
        ov.style.cssText = 'position:fixed;inset:0;top:0;right:0;bottom:0;left:0;z-index:2147483500;background:rgba(15,23,42,.97);direction:rtl;' +
            'display:flex;align-items:center;justify-content:center;font-family:inherit;color:#e2e8f0;padding:24px;';
        ov.innerHTML =
            '<div style="max-width:460px;width:100%;text-align:center;background:#1e293b;border:1px solid #334155;border-radius:18px;padding:30px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5);">' +
                '<div style="font-size:46px;color:#f59e0b;margin-bottom:14px;"><i class="fas fa-lock"></i></div>' +
                '<h2 style="margin:0 0 10px;font-size:19px;color:#fff;">مهلت نسخهٔ آزمایشی تمام شد</h2>' +
                '<p style="margin:0 0 22px;font-size:13.5px;line-height:2.1;color:#cbd5e1;">' + MSG_END + '</p>' +
                '<button id="jouya-demo-lock-register" type="button" style="background:#2563eb;border:none;color:#fff;border-radius:10px;' +
                    'padding:12px 22px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;">' +
                    '<i class="fas fa-user-plus"></i> ساخت حساب / فعال‌سازی' +
                '</button>' +
            '</div>';
        document.body.appendChild(ov);
        var btn = document.getElementById('jouya-demo-lock-register');
        if (btn) btn.onclick = function () { _openRegisterFromLock(); };
        var b = document.getElementById('jouya-demo-badge'); if (b) b.remove();
    }

    // از کارتِ قفل → تبِ «ثبت‌نام» صفحهٔ ورود
    function _openRegisterFromLock() {
        _lsDel(K_END);
        var lk = document.getElementById('jouya-demo-lock'); if (lk) lk.remove();
        try { document.body.style.overflow = ''; } catch (e) {}
        try {
            if (window.AuthUI && typeof window.AuthUI.switchTab === 'function' && document.getElementById('auth-panel-register')) {
                window.AuthUI.switchTab('register');
                return;
            }
        } catch (e) {}
        _lsSet('__jouya_demo_goto_register', '1');
        try { location.reload(); } catch (e) {}
    }

    // ---- بررسیِ دوره‌ای (به‌روزرسانیِ نشان + پایانِ مهلت، حتی اگر برنامه باز بماند) ----
    var _timer = null;
    function _scheduleChecks() {
        if (_timer) return;
        _timer = setInterval(function () {
            var s = status();
            if (!s.active) return;
            if (s.expired) { clearInterval(_timer); _timer = null; _expire(); return; }
            _renderBadge();
        }, 60 * 1000);   // هر دقیقه
    }

    // ---- دکمهٔ «ورود به‌عنوان مهمان (نسخهٔ آزمایشی یک‌هفته‌ای)» در پنلِ ورود ----
    function _hideButton() {
        var btn = document.getElementById('jouya-demo-login-btn');
        if (btn) { var w = btn.parentNode; if (w && w.getAttribute('data-demo-wrap') === '1') w.remove(); else btn.remove(); }
    }
    function _injectButton() {
        if (_hasRealAccount() || _isUsed() || !_idbChecked) { if (_isUsed() || _hasRealAccount()) _hideButton(); return; }
        var panel = document.getElementById('auth-panel-login');
        if (!panel) return;
        if (document.getElementById('jouya-demo-login-btn')) return;
        var wrap = document.createElement('div');
        wrap.setAttribute('data-demo-wrap', '1');
        wrap.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px dashed #cbd5e1;text-align:center;';
        wrap.innerHTML =
            '<button id="jouya-demo-login-btn" type="button" style="width:100%;background:#fff;border:1.5px solid #1e3a5f;' +
                'color:#1e3a5f;border-radius:10px;padding:11px 16px;font-family:inherit;font-weight:700;font-size:13.5px;' +
                'cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">' +
                '<i class="fas fa-user-clock"></i> ورود به‌عنوان مهمان (نسخهٔ آزمایشی یک‌هفته‌ای)' +
            '</button>';
        panel.appendChild(wrap);
        var btn = document.getElementById('jouya-demo-login-btn');
        if (btn) btn.onclick = function () { start(); };
    }

    // ---- بررسیِ اولیه هنگام بالا آمدنِ برنامه ----
    function check() {
        // پس از پاک‌سازی: کارتِ قفل (مگر حسابِ واقعی ساخته شده باشد)
        if (_lsGet(K_END) === '1') {
            if (_hasRealAccount()) _lsDel(K_END);
            else { _lock(); return; }
        }
        var s = status();
        if (!s.active) { _injectButton(); return; }   // Demo فعال نیست → فقط دکمه (اگر مجاز است)
        if (!_isUsed()) _markUsed();                   // Demoِ شروع‌شده پیش از این نسخه → نشانه ثبت شود
        if (s.expired || s.tampered) { _expire(); return; }
        _revealApp();
        _renderBadge();
        _scheduleChecks();
    }

    // ---- ناظرِ DOM: هم دکمه را در صفحهٔ ورود تزریق می‌کند، هم اگر Demo فعال است اورلیِ
    //      ورود را برمی‌دارد (بدونِ وابستگی به ترتیبِ بارگذاریِ اسکریپت‌ها) ----
    function _observe() {
        try {
            var mo = new MutationObserver(function () {
                if (_wiping) return;
                if (_lsGet(K_END) === '1' && !_hasRealAccount()) { _lock(); return; }
                var s = status();
                if (s.active && !s.expired && !s.tampered) {
                    if (document.getElementById('auth-screen-overlay')) _revealApp();
                } else if (!s.active) {
                    if (document.getElementById('auth-panel-login')) _injectButton();
                } else if (s.expired || s.tampered) {
                    _expire();
                }
            });
            mo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) {}
    }

    // API عمومی
    var JouyaDemo = {
        start: start,
        status: status,
        isActive: isActive,
        isUsed: function () { return _isUsed(); },
        check: check,
        _cloudHook: null,
        // برای تست/پشتیبانی: پاک‌سازیِ حالتِ Demo (نشانهٔ یک‌بار مصرف عمداً باقی می‌ماند)
        _reset: function () { _lsDel(K_STATE); }
    };
    if (typeof window !== 'undefined') window.JouyaDemo = JouyaDemo;

    // راه‌اندازی
    function _boot() {
        _observe();
        _maybeOpenRegister();
        // نشانهٔ IndexedDB خوانده می‌شود؛ تا پاسخ نیاید دکمهٔ مهمان نمایش داده نمی‌شود
        _idbGetUsed().then(function (rec) {
            _idbChecked = true;
            if (rec) {
                _usedIdb = true;
                if (!_usedLs()) { try { _lsSet(K_USED, JSON.stringify(rec)); } catch (e) {} }
                _hideButton();
            } else if (_usedLs()) {
                _markUsed();                              // فقط در localStorage بود → در IndexedDB هم ثبت شود
            }
            if (!isActive() && _lsGet(K_END) !== '1') _injectButton();
        }, function () {
            _idbChecked = true;                           // IndexedDB در دسترس نیست → فقط localStorage
            if (!isActive() && _lsGet(K_END) !== '1') _injectButton();
        });
        setTimeout(check, 60);
    }
    function _maybeOpenRegister() {
        var flag = _lsGet('__jouya_demo_goto_register');
        if (flag !== '1') return;
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            try {
                if (window.AuthUI && typeof window.AuthUI.switchTab === 'function' && document.getElementById('auth-panel-register')) {
                    window.AuthUI.switchTab('register');
                    _lsDel('__jouya_demo_goto_register');
                    clearInterval(iv);
                    return;
                }
            } catch (e) {}
            if (tries > 40) { clearInterval(iv); _lsDel('__jouya_demo_goto_register'); }
        }, 150);
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
        else _boot();
    }

    // برای Node/تست
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { _hash: _hash, _sig: _sig };
    }
})();
