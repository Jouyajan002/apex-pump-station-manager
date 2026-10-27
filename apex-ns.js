/**
 * apex-ns.js — جداسازیِ کاملِ حافظهٔ محلیِ «APEX Pump Station Manager»
 * =============================================================================
 * چرا لازم است؟
 *   نسخهٔ وبِ دو برنامه (APEX Store Manager و APEX Pump Station Manager) اگر روی
 *   یک دامنه منتشر شوند (مثلاً هر دو روی  username.github.io/...)، مرورگر برای هر دو
 *   «یک» localStorage می‌دهد؛ چون هر دو برنامه کلیدهای هم‌نام دارند (products،
 *   transactions، jouya_user_account، …) داده‌ها با هم قاطی می‌شدند.
 *
 * راهِ حل:
 *   همهٔ کلیدهای این برنامه با پیشوندِ ثابتِ «apexps:» ذخیره می‌شوند. این لایه
 *   متدهای Storage.prototype را می‌پوشاند؛ پس بقیهٔ کدِ برنامه همان نام‌های قبلی را
 *   می‌بیند و هیچ فایلی لازم نیست تغییر کند. کلیدهای برنامهٔ دیگر (بدونِ پیشوند)
 *   برای این برنامه «نامرئی»اند و هرگز خوانده، نوشته یا پاک نمی‌شوند.
 *
 *   • getItem / setItem / removeItem → با پیشوند
 *   • key(i) / length → فقط کلیدهای همین برنامه (بدونِ پیشوند برگردانده می‌شوند)
 *   • clear() → فقط کلیدهای همین برنامه پاک می‌شود
 *
 * این فایل باید «اولین» اسکریپتِ صفحه باشد (پیش از jouya-store.js و هر کدی که به
 * localStorage دست می‌زند).
 * =============================================================================
 */
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof Storage === 'undefined') return;
    if (window.__apexNsInstalled) return;
    window.__apexNsInstalled = true;

    var PFX = 'apexps:';
    var SP = Storage.prototype;
    var _get = SP.getItem, _set = SP.setItem, _rem = SP.removeItem, _key = SP.key, _clear = SP.clear;
    var _lenDesc = Object.getOwnPropertyDescriptor(SP, 'length');
    var _rawLen = function (st) { return _lenDesc && _lenDesc.get ? _lenDesc.get.call(st) : 0; };

    function ns(k) { return PFX + String(k); }
    function ownKeys(st) {
        var out = [], n = _rawLen(st), i, k;
        for (i = 0; i < n; i++) {
            k = _key.call(st, i);
            if (k != null && k.indexOf(PFX) === 0) out.push(k.slice(PFX.length));
        }
        return out;
    }

    SP.getItem = function (k) { return _get.call(this, ns(k)); };
    SP.setItem = function (k, v) { return _set.call(this, ns(k), v); };
    SP.removeItem = function (k) { return _rem.call(this, ns(k)); };
    SP.key = function (i) { var a = ownKeys(this); return (i >= 0 && i < a.length) ? a[i] : null; };
    SP.clear = function () {
        var a = ownKeys(this), self = this;
        a.forEach(function (k) { try { _rem.call(self, ns(k)); } catch (e) {} });
    };
    try {
        Object.defineProperty(SP, 'length', {
            configurable: true, enumerable: true,
            get: function () { return ownKeys(this).length; }
        });
    } catch (e) {}

    // برای عیب‌یابی
    window.__APEX_NS = { prefix: PFX, rawKeys: function () { var a = [], n = _rawLen(localStorage), i; for (i = 0; i < n; i++) a.push(_key.call(localStorage, i)); return a; } };
})();
