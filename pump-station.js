/**
 * pump-station.js — منطقِ اختصاصیِ «APEX Pump Station Manager»
 * =============================================================================
 * این فایل «آخرین» اسکریپتِ صفحه است و روی هستهٔ مشترکِ برنامه (script.js /
 * database.js) سوار می‌شود. هیچ منطقِ مالی، حساب‌ها، اشخاص، فعال‌سازی یا ورود
 * تغییر نمی‌کند؛ فقط بخش‌های مخصوصِ پمپ استیشن اضافه/جایگزین می‌شوند:
 *
 *   • ذخایر (Tank) = همان رکوردِ «جنس» با فیلدهای اضافی: ظرفیت کل، ثقل، نوع تیل
 *   • میتر (Meter) و قرائتِ میتر (Meter Reading) — کلکسیون‌های جدید
 *   • بل فروش/خرید با سطرهای «نوع تیل، مقدار، واحد، ثقل، قیمت، مجموعه، لیتر،
 *     میتر، ذخیره» و تبدیلِ خودکارِ واحد با ثقل:  لیتر = (تن × ۱۰۰۰) ÷ ثقل
 *   • انتقالِ تیل بین ذخایر (همان رکوردِ انتقالِ گدامِ برنامهٔ اصلی)
 *   • مصرف انتقال در بل فروش، افزودنِ مبلغ به پرداختی (⊕)
 *   • کارتِ «قید/قرائت میتر» در داشبورد، گزارشِ میترها (اکسل/PDF)
 *
 * اصلِ ذخیره‌سازیِ اقلام: هر قلمِ بل در «واحدِ اصلیِ ذخیره» (معمولاً لیتر) ذخیره
 * می‌شود (quantity/price)، تا موجودی، FIFO، مفاد، برگشت‌ها و گزارش‌های موجود
 * بدونِ هیچ تغییری درست کار کنند. مقدار/واحد/قیمتِ واردشدهٔ کاربر (مثلاً ۲ تن)
 * در فیلدهای جداگانه (enteredQty / enteredUnit / enteredPrice) روی همان قلم
 * نگه داشته می‌شود و در نمایش/چاپ استفاده می‌شود.
 * =============================================================================
 */
(function () {
    'use strict';
    if (window.__apexPumpStationLoaded) return;
    window.__apexPumpStationLoaded = true;

    // ────────────────────────────── ابزارهای عمومی ──────────────────────────────
    var PS = window.PumpStation = window.PumpStation || {};

    function N(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
    function R(v, d) { var p = Math.pow(10, d == null ? 3 : d); return Math.round((N(v) + 0) * p) / p; }
    function fmt(v, d) {
        var x = R(v, d == null ? 3 : d);
        try { if (typeof formatNumber === 'function') return formatNumber(x); } catch (e) {}
        return String(x);
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function $(id) { return document.getElementById(id); }
    function lsGet(k, def) {
        try { var v = JSON.parse(localStorage.getItem(k)); return (v == null) ? def : v; } catch (e) { return def; }
    }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    function baseCur() { try { return _baseCur(); } catch (e) { return 'AFN'; } }
    function curLabel(c) { try { return getCurrencyLabel(c); } catch (e) { return c; } }
    function nowDT() { try { return _nowJalaliDateTime(); } catch (e) { return new Date().toISOString(); } }
    function today() { return String(nowDT()).split(' ')[0]; }
    function toEn(s) { try { return toEnglishDigits(String(s == null ? '' : s)); } catch (e) { return String(s == null ? '' : s); } }
    function dateMs(s) {
        if (s == null || s === '') return 0;
        if (typeof s === 'number') return s;
        try { if (typeof _hbDateToMs === 'function') { var m = _hbDateToMs(toEn(s)); if (m) return m; } } catch (e) {}
        var t = new Date(s).getTime();
        return isNaN(t) ? 0 : t;
    }
    function msg(t, m) { try { showMessage(t, m); } catch (e) { alert(m); } }
    function toast(m, type) { try { showToast(m, type || 'success'); } catch (e) { try { showMessage('پیام', m); } catch (e2) {} } }
    function ask(t, m, cb) { try { showConfirm(t, m, cb); } catch (e) { if (confirm(m)) cb(); } }
    function newId() { try { return db._nextId(); } catch (e) { return Date.now() + Math.floor(Math.random() * 1000); } }
    function applyDigits() { try { if (typeof applyNumberSystemToDocument === 'function') applyNumberSystemToDocument(); } catch (e) {} }
    function products() { try { return db.getProducts() || []; } catch (e) { return []; } }
    function allProducts() { try { return (db.getAllProducts ? db.getAllProducts() : db.getProducts()) || []; } catch (e) { return []; } }
    function getProduct(id) {
        if (id == null || id === '') return null;
        return allProducts().find(function (p) { return p && String(p.id) === String(id); }) || null;
    }
    function transactions() { try { return db.getTransactions() || []; } catch (e) { return []; } }
    function sectionActive(id) { var s = $(id); return !!(s && s.classList.contains('active')); }

    PS.N = N; PS.R = R; PS.fmt = fmt; PS.esc = esc;

    // ────────────────────────────── انواعِ تیل و واحدها ──────────────────────────────
    // ثقلِ پیش‌فرضِ رایج (کاربر می‌تواند برای هر ذخیره/بل مقدارِ دقیق را وارد کند)
    var FUEL_GRAVITY = { 'پطرول': 0.74, 'بنزین': 0.74, 'دیزل': 0.84, 'تیل سوپر': 0.75, 'سوپر': 0.75, 'گاز مایع': 0.54, 'گاز': 0.54, 'تیل خاک': 0.80, 'مبل': 0.88, 'موبلیل': 0.88 };
    var DEFAULT_FUELS = ['پطرول', 'دیزل', 'تیل سوپر', 'گاز مایع'];
    var DEFAULT_UNITS = ['لیتر', 'تن', 'کیلوگرام', 'گیلن', 'متر مکعب', 'بیرل'];
    var FUEL_COLORS = { 'پطرول': '#16a34a', 'دیزل': '#1e3a5f', 'تیل سوپر': '#dc2626', 'گاز مایع': '#0891b2' };

    function fuelColor(f) {
        if (FUEL_COLORS[f]) return FUEL_COLORS[f];
        var pal = ['#7c3aed', '#d97706', '#0d9488', '#be185d', '#475569'];
        var h = 0; String(f || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
        return pal[h % pal.length];
    }
    function fuelTypes() {
        var a = lsGet('customProductCategories', []);
        if (!Array.isArray(a)) a = [];
        // انواعِ تیلی که روی ذخایرِ موجود ثبت شده‌اند هم بیایند (مثلاً پس از import)
        products().forEach(function (p) { var f = p && (p.fuelType || p.categoryMain); if (f && a.indexOf(f) === -1) a.push(f); });
        return a;
    }
    function defaultGravity(fuel) {
        if (!fuel) return 0;
        if (FUEL_GRAVITY[fuel] != null) return FUEL_GRAVITY[fuel];
        var k = Object.keys(FUEL_GRAVITY).find(function (x) { return String(fuel).indexOf(x) !== -1; });
        return k ? FUEL_GRAVITY[k] : 0;
    }
    function tankFuel(p) { return p ? (p.fuelType || p.categoryMain || '') : ''; }
    function tankGravity(p) { var g = N(p && p.gravity); return g > 0 ? g : defaultGravity(tankFuel(p)); }

    // لیترِ معادلِ «یک» واحد (null = تبدیلِ حجمی ناشناخته)
    function unitLiters(unit, g) {
        var u = String(unit || '').trim().toLowerCase();
        if (!u) return null;
        g = N(g);
        if (/^(لیتر|لتر|ليتر|liter|litre|l|lt|ltr)$/.test(u)) return 1;
        if (/^(ملی ?لیتر|ml)$/.test(u)) return 0.001;
        if (/^(تن|ټن|ton|tonne|t|متریک تن)$/.test(u)) return g > 0 ? 1000 / g : null;
        if (/^(کیلوگرام|کیلو|کیلوگرم|kg)$/.test(u)) return g > 0 ? 1 / g : null;
        if (/^(گیلن|گالن|gallon|gal)$/.test(u)) return 3.785411784;
        if (/^(متر مکعب|مترمکعب|m3|متر‌مکعب|کیوبیک متر)$/.test(u)) return 1000;
        if (/^(بیرل|بشکه|barrel|bbl)$/.test(u)) return 158.987294928;
        return null;
    }
    // لیترِ معادلِ یک واحد برای یک ذخیرهٔ مشخص (با درنظرگرفتنِ واحدِ فرعیِ خودِ ذخیره)
    function litersPerUnit(prod, unit, g) {
        var L = unitLiters(unit, g);
        if (L != null) return L;
        if (!prod) return null;
        var Lp = unitLiters(prod.unit, g);
        if (unit === prod.unit) return Lp;
        if (prod.hasSecondaryUnit && unit === prod.secondaryUnit && N(prod.secondaryUnitFactor) > 0 && Lp != null) return Lp / N(prod.secondaryUnitFactor);
        return null;
    }
    // چند «واحدِ اصلیِ ذخیره» = یک واحدِ واردشده
    function primaryPerUnit(prod, unit, g) {
        if (!prod) return null;
        if (!unit || unit === prod.unit) return 1;
        // اولویت با تبدیلِ فیزیکی (با ثقلِ همین سطر)؛ ضریبِ واحدِ فرعیِ ذخیره فقط برای واحدهای ناشناخته
        var Le = unitLiters(unit, g), Lp = unitLiters(prod.unit, g);
        if (Le != null && Lp != null && Lp > 0) return Le / Lp;
        if (prod.hasSecondaryUnit && unit === prod.secondaryUnit && N(prod.secondaryUnitFactor) > 0) return 1 / N(prod.secondaryUnitFactor);
        return null;
    }
    // لیترِ موجودیِ یک ذخیره (null اگر واحدِ اصلی حجمی نباشد)
    function stockLiters(p, qty) {
        var Lp = unitLiters(p && p.unit, tankGravity(p));
        if (Lp == null) return null;
        return N(qty == null ? (p && p.stock) : qty) * Lp;
    }
    function unitsForTank(p) {
        var a = DEFAULT_UNITS.slice();
        if (p) {
            if (p.unit && a.indexOf(p.unit) === -1) a.unshift(p.unit);
            if (p.hasSecondaryUnit && p.secondaryUnit && a.indexOf(p.secondaryUnit) === -1) a.push(p.secondaryUnit);
        }
        var custom = lsGet('customProductUnits', []);
        if (Array.isArray(custom)) custom.forEach(function (u) { if (u && a.indexOf(u) === -1 && unitLiters(u, 0.8) != null) a.push(u); });
        return a;
    }
    function qtyText(p, qty) {
        var unit = (p && p.unit) || '';
        var s = '‏' + fmt(qty) + (unit ? ' ' + unit : '');
        var L = stockLiters(p, qty);
        if (L != null && unitLiters(unit, 1) !== 1) s += ' <small class="ps-muted">(' + fmt(L, 1) + ' لیتر)</small>';
        return s;
    }

    PS.unitLiters = unitLiters; PS.litersPerUnit = litersPerUnit; PS.primaryPerUnit = primaryPerUnit;
    PS.stockLiters = stockLiters; PS.fuelTypes = fuelTypes; PS.defaultGravity = defaultGravity;
    PS.tankGravity = tankGravity; PS.tankFuel = tankFuel;

    // ────────────────────────────── مقداردهیِ اولیه (یک‌بار) ──────────────────────────────
    function seedDefaults() {
        try {
            var cats = lsGet('customProductCategories', null);
            if (!Array.isArray(cats) || !cats.length) lsSet('customProductCategories', DEFAULT_FUELS.slice());
            var units = lsGet('customProductUnits', null);
            if (!Array.isArray(units)) units = [];
            var changed = false;
            DEFAULT_UNITS.forEach(function (u) { if (units.indexOf(u) === -1) { units.push(u); changed = true; } });
            if (changed) lsSet('customProductUnits', units);
            if (!Array.isArray(lsGet('meters', null))) lsSet('meters', []);
            if (!Array.isArray(lsGet('meterReadings', null))) lsSet('meterReadings', []);
            // کتگوریِ مصرفِ «مصرف انتقال» برای فورمِ مصارف
            var ec = lsGet('customExpenseCategories', null);
            if (Array.isArray(ec) && ec.indexOf('مصرف انتقال') === -1) { ec.push('مصرف انتقال'); lsSet('customExpenseCategories', ec); }
            else if (!Array.isArray(ec)) lsSet('customExpenseCategories', ['مصرف انتقال']);
        } catch (e) { console.warn('pump seed:', e); }
    }
    seedDefaults();

    // ────────────────────────────── میترها و قرائت‌ها (ذخیره‌سازی) ──────────────────────────────
    function getMeters() { var a = lsGet('meters', []); return Array.isArray(a) ? a.filter(Boolean) : []; }
    function saveMetersList(a) { lsSet('meters', a || []); }
    function getMeter(id) { return getMeters().find(function (m) { return String(m.id) === String(id); }) || null; }
    function getReadings() { var a = lsGet('meterReadings', []); return Array.isArray(a) ? a.filter(Boolean) : []; }
    function saveReadingsList(a) { lsSet('meterReadings', a || []); }
    function readingsOf(meterId) {
        return getReadings().filter(function (r) { return String(r.meterId) === String(meterId); })
            .sort(function (a, b) { return (N(a.at) - N(b.at)) || (N(a.createdAtMs) - N(b.createdAtMs)); });
    }
    function lastReadingOf(meterId, beforeAt, excludeId) {
        var list = readingsOf(meterId).filter(function (r) {
            if (excludeId != null && String(r.id) === String(excludeId)) return false;
            return beforeAt == null || N(r.at) <= N(beforeAt);
        });
        return list.length ? list[list.length - 1] : null;
    }
    function meterCurrentReading(m) {
        var l = lastReadingOf(m.id);
        return l ? N(l.currentReading) : N(m.initialReading);
    }
    // بازسازیِ زنجیرهٔ «قرائت قبلی/مقدار مصرف» یک میتر به ترتیبِ زمانی
    function rechain(meterId) {
        var m = getMeter(meterId);
        if (!m) return;
        var all = getReadings();
        var mine = all.filter(function (r) { return String(r.meterId) === String(meterId); })
            .sort(function (a, b) { return (N(a.at) - N(b.at)) || (N(a.createdAtMs) - N(b.createdAtMs)); });
        var prev = N(m.initialReading);
        var prevAt = dateMs(m.date || m.createdAt);
        mine.forEach(function (r) {
            r.prevReading = prev;
            r.dispensed = R(N(r.currentReading) - prev, 3);
            r.periodStart = prevAt;
            var billed = billedLiters(meterId, prevAt, N(r.at), r.id);
            r.billedLiters = R(billed, 3);
            r.diffLiters = R(N(r.dispensed) - billed, 3);
            r.diffValue = R(N(r.diffLiters) * N(r.pricePerLiter), 2);
            prev = N(r.currentReading);
            prevAt = N(r.at);
        });
        saveReadingsList(all);
    }
    // لیترِ فروخته‌شده با یک میتر در بازهٔ (fromAt, toAt] — بل‌های فروشِ ثبت‌شده
    function billedLiters(meterId, fromAt, toAt, readingId) {
        var sum = 0;
        transactions().forEach(function (tx) {
            if (!tx || tx.type !== 'فروش' || !Array.isArray(tx.items)) return;
            if (tx.psAutoReadingId != null && String(tx.psAutoReadingId) === String(readingId)) return;
            var at = dateMs(tx.date) || dateMs(tx.createdAt);
            if (fromAt && at <= fromAt) return;
            if (toAt && at > toAt) return;
            tx.items.forEach(function (it) {
                if (!it || String(it.meterId || '') !== String(meterId)) return;
                var L = N(it.liters);
                if (!(L > 0)) {
                    var p = getProduct(it.productId);
                    var Lp = p ? unitLiters(p.unit, N(it.gravity) || tankGravity(p)) : 1;
                    L = N(it.quantity) * (Lp == null ? 1 : Lp);
                }
                sum += L;
            });
        });
        return sum;
    }

    PS.getMeters = getMeters; PS.getMeter = getMeter; PS.getReadings = getReadings;
    PS.readingsOf = readingsOf; PS.meterCurrentReading = meterCurrentReading; PS.rechain = rechain;
    PS.billedLiters = billedLiters;

    // منوی شناورِ سه‌نقطه (هم‌سبکِ منوی ذخایر/اشخاصِ برنامه)
    function floatMenu(event, actions, onPick) {
        try { if (typeof __hbEnsureGhostGuard === 'function') __hbEnsureGhostGuard(); } catch (e) {}
        try { if (event && event.type === 'mouseenter' && typeof __hbTouchLike === 'function' && __hbTouchLike()) return; } catch (e) {}
        try { if (window.closeProductToolbarTimer) { clearTimeout(window.closeProductToolbarTimer); window.closeProductToolbarTimer = null; } } catch (e) {}
        try { if (window.currentProductToolbar) { window.currentProductToolbar.remove(); window.currentProductToolbar = null; } } catch (e) {}
        var tb = document.createElement('div');
        tb.className = 'floating-action-toolbar ps-float-menu';
        try { if (typeof __hbTouchLike === 'function' && __hbTouchLike()) tb.dataset.hbOpenedAt = String(Date.now()); } catch (e) {}
        Object.assign(tb.style, {
            position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '4px',
            backgroundColor: '#ffffff', padding: '8px', borderRadius: '12px', boxShadow: '0 5px 20px rgba(0,0,0,0.2)',
            border: '1px solid #cbd5e1', zIndex: '9999', whiteSpace: 'nowrap', minWidth: '210px'
        });
        actions.forEach(function (a) {
            var b = document.createElement('button');
            b.type = 'button'; b.title = a.title;
            b.innerHTML = '<i class="fas ' + a.icon + '" style="width:18px;text-align:center;color:' + a.color + ';"></i><span style="margin-right:10px;font-size:13px;color:#1e293b;font-weight:500;">' + esc(a.title) + '</span>';
            Object.assign(b.style, { background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', borderRadius: '6px', textAlign: 'right', fontFamily: 'inherit' });
            b.onmouseenter = function () { b.style.background = '#f1f5f9'; };
            b.onmouseleave = function () { b.style.background = 'transparent'; };
            b.onclick = function (e) { e.stopPropagation(); closeFloat(); onPick(a.action); };
            tb.appendChild(b);
        });
        tb.addEventListener('mouseenter', function () { if (window.closeProductToolbarTimer) { clearTimeout(window.closeProductToolbarTimer); window.closeProductToolbarTimer = null; } });
        tb.addEventListener('mouseleave', function () { try { startCloseProductToolbarTimer(); } catch (e) { closeFloat(); } });
        document.body.appendChild(tb);
        window.currentProductToolbar = tb;
        try { currentProductToolbar = tb; } catch (e) {}
        var t = event && (event.currentTarget || event.target);
        var rect = t ? t.getBoundingClientRect() : { top: 100, right: 100 };
        var st = window.pageYOffset || document.documentElement.scrollTop;
        var sl = window.pageXOffset || document.documentElement.scrollLeft;
        tb.style.top = (rect.top + st) + 'px';
        var left = rect.right + sl + 10;
        var maxLeft = sl + document.documentElement.clientWidth - 230;
        tb.style.left = Math.max(8 + sl, Math.min(left, maxLeft)) + 'px';
        try { tb.animate([{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 180 }); } catch (e) {}
    }
    function closeFloat() {
        try { if (typeof closeProductActionBar === 'function') closeProductActionBar(); } catch (e) {}
        try { var x = document.querySelectorAll('.ps-float-menu'); x.forEach(function (n) { n.remove(); }); } catch (e) {}
    }

    // مودالِ سادهٔ اختصاصی (هم‌رنگِ برنامه)
    function modal(title, bodyHtml, buttons, opts) {
        closeModal();
        var ov = document.createElement('div');
        ov.className = 'ps-modal-overlay';
        ov.id = 'ps-modal-overlay';
        var html = '<div class="ps-modal' + ((opts && opts.wide) ? ' ps-modal-wide' : '') + '" role="dialog" aria-modal="true">' +
            '<div class="ps-modal-head"><span>' + title + '</span><button type="button" class="ps-modal-x" onclick="PumpStation.closeModal()" title="بستن"><i class="fas fa-times"></i></button></div>' +
            '<div class="ps-modal-body">' + bodyHtml + '</div>' +
            '<div class="ps-modal-foot"></div></div>';
        ov.innerHTML = html;
        var foot = ov.querySelector('.ps-modal-foot');
        (buttons || []).forEach(function (b) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = b.primary ? 'ps-panel-btn' : 'ps-panel-btn ps-panel-btn-alt';
            btn.innerHTML = b.html;
            btn.onclick = b.onClick;
            foot.appendChild(btn);
        });
        ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
        document.body.appendChild(ov);
        applyDigits();
        return ov;
    }
    function closeModal() { var o = $('ps-modal-overlay'); if (o) o.remove(); }
    PS.closeModal = closeModal;

    // =============================================================================
    //  فورمِ «ثبت تیل و ذخیره»
    // =============================================================================
    function tfVal(id) { var e = $(id); return e ? e.value : ''; }
    function tfSet(id, v) { var e = $(id); if (e) e.value = (v == null ? '' : v); }

    // نوع تیل عوض شد → ثقلِ پیش‌فرض (اگر خالی است) + بازمحاسبه
    function tankFormFuelChanged() {
        var fuel = tfVal('product-category-main');
        var gEl = $('product-gravity');
        if (gEl && !N(gEl.value)) { var g = defaultGravity(fuel); if (g) gEl.value = g; }
        tankFormRecalc('gravity');
    }
    function tankFormRecalc(src) {
        try {
            var unit = tfVal('product-unit');
            var hasSec = !!($('product-has-secondary-unit') && $('product-has-secondary-unit').checked);
            var secUnit = tfVal('product-secondary-unit');
            var g = N(tfVal('product-gravity'));
            var fEl = $('product-secondary-unit-factor');
            // ضریب = تعدادِ واحدِ فرعی در «یک» واحدِ اصلی  → Lp / Ls
            if (hasSec && secUnit && fEl) {
                var Lp = unitLiters(unit, g), Ls = unitLiters(secUnit, g);
                if (src === 'factor') fEl.dataset.auto = '0';
                if (Lp != null && Ls != null && Ls > 0 && (fEl.dataset.auto !== '0' || !N(fEl.value)) && src !== 'factor') {
                    fEl.value = R(Lp / Ls, 8);
                    fEl.dataset.auto = '1';
                }
            }
            var f = N(fEl && fEl.value);
            if (hasSec && f > 0) {
                var pair = function (mainId, secId, fromMain) {
                    var m = $(mainId), s = $(secId); if (!m || !s) return;
                    if (fromMain) { if (m.value !== '') s.value = R(N(m.value) * f, 6); }
                    else { if (s.value !== '') m.value = R(N(s.value) / f, 6); }
                };
                var pairPrice = function (mainId, secId, fromMain) {
                    var m = $(mainId), s = $(secId); if (!m || !s) return;
                    // قیمتِ هر واحدِ فرعی = قیمتِ واحدِ اصلی ÷ ضریب
                    if (fromMain) { if (m.value !== '') s.value = R(N(m.value) / f, 4); }
                    else { if (s.value !== '') m.value = R(N(s.value) * f, 4); }
                };
                if (src === 'stock-sec') pair('product-initial-stock', 'product-secondary-initial-stock', false);
                else pair('product-initial-stock', 'product-secondary-initial-stock', true);
                if (src === 'pp-sec') pairPrice('product-purchase-price-afn', 'product-secondary-purchase-price-afn', false);
                else pairPrice('product-purchase-price-afn', 'product-secondary-purchase-price-afn', true);
                if (src === 'sp-sec') pairPrice('product-sale-price-afn', 'product-secondary-sale-price-afn', false);
                else pairPrice('product-sale-price-afn', 'product-secondary-sale-price-afn', true);
            }
            renderTankCalc();
        } catch (e) { console.warn('tankFormRecalc:', e); }
    }
    function renderTankCalc() {
        var box = $('ps-tank-calc'); if (!box) return;
        var unit = tfVal('product-unit');
        var g = N(tfVal('product-gravity'));
        var stock = N(tfVal('product-initial-stock'));
        var cap = N(tfVal('product-capacity'));
        var fuel = tfVal('product-category-main');
        var Lp = unitLiters(unit, g);
        var rows = [];
        if (!unit) { box.innerHTML = '<div class="ps-calc-hint"><i class="fas fa-circle-info"></i> واحد شمارش اصلی را انتخاب کنید (مثلاً لیتر یا تن).</div>'; return; }
        if (Lp == null && /تن|کیلو/.test(unit) && !g) rows.push('<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> برای واحدِ «' + esc(unit) + '» ثقل را وارد کنید تا لیتر محاسبه شود.</div>');
        if (Lp != null) {
            if (Lp !== 1) rows.push('<div class="ps-calc-row"><span>یک ' + esc(unit) + '</span><b>' + fmt(Lp, 4) + ' لیتر</b></div>');
            if (stock) rows.push('<div class="ps-calc-row"><span>موجودی اولیه</span><b>' + fmt(stock * Lp, 3) + ' لیتر</b></div>');
            if (g > 0 && stock) rows.push('<div class="ps-calc-row"><span>وزنِ موجودی (با ثقل ' + fmt(g, 4) + ')</span><b>' + fmt(stock * Lp * g / 1000, 4) + ' تن</b></div>');
            if (cap) rows.push('<div class="ps-calc-row"><span>ظرفیت کل</span><b>' + fmt(cap * Lp, 3) + ' لیتر</b></div>');
        }
        if (cap > 0) {
            var pct = stock / cap * 100;
            rows.push('<div class="ps-fill"><div class="ps-fill-bar" style="width:' + Math.max(0, Math.min(100, pct)) + '%;background:' + fuelColor(fuel) + '"></div><span>' + fmt(pct, 1) + '٪ پُر</span></div>');
            if (stock > cap) rows.push('<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> موجودی اولیه از ظرفیت کلِ ذخیره بیشتر است.</div>');
        }
        if (g && (g < 0.3 || g > 1.5)) rows.push('<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> ثقل معمولاً بین ۰٫۵ تا ۱ است (مثلاً پطرول ۰٫۷۴، دیزل ۰٫۸۴).</div>');
        box.innerHTML = rows.length ? rows.join('') : '<div class="ps-calc-hint"><i class="fas fa-calculator"></i> فرمول: لیتر = (تن × ۱۰۰۰) ÷ ثقل</div>';
        applyDigits();
    }
    window.psTankFormFuelChanged = tankFormFuelChanged;
    window.psTankFormRecalc = tankFormRecalc;

    // فیلدهای اضافیِ ذخیره هنگامِ ثبت (هوکِ داخلِ saveProduct)
    window._psProductExtras = function () {
        var cap = tfVal('product-capacity'), g = tfVal('product-gravity');
        return {
            capacity: cap === '' ? 0 : N(cap),
            gravity: g === '' ? 0 : N(g),
            fuelType: tfVal('product-category-main')
        };
    };
    window._psValidateProduct = function (p) {
        if (!String(p.name || '').trim()) return 'لطفاً نام ذخیره را وارد کنید.';
        if (!p.categoryMain) return 'لطفاً نوع تیل را انتخاب کنید.';
        if (!p.unit) return 'لطفاً واحد شمارش اصلی را انتخاب کنید.';
        if (N(p.gravity) && (N(p.gravity) < 0.3 || N(p.gravity) > 1.5)) return 'ثقل واردشده معتبر نیست (معمولاً بین ۰٫۵ تا ۱).';
        if (N(p.capacity) < 0) return 'ظرفیت کل نمی‌تواند منفی باشد.';
        if (N(p.capacity) > 0 && N(p.initialStock) > N(p.capacity) + 1e-9) return 'موجودی اولیه از ظرفیت کلِ ذخیره بیشتر است.';
        // نمبر ذخیره تکراری نباشد
        var code = String(p.code || '').trim();
        if (code) {
            var editId = ($('productForm') && $('productForm').dataset.editId) || '';
            var dup = allProducts().some(function (x) { return x && String(x.code || '').trim() === code && String(x.id) !== String(editId); });
            if (dup) return 'این نمبر ذخیره قبلاً ثبت شده است.';
        }
        // واحدهای حجمی/وزنی که ثقل می‌خواهند
        if ((unitLiters(p.unit, 1) == null && /تن|کیلو/.test(p.unit)) && !N(p.gravity)) return 'برای واحدِ «' + p.unit + '» وارد کردنِ ثقل الزامی است.';
        return '';
    };

    function wrap(name, after, before) {
        var orig = window[name];
        if (typeof orig !== 'function') return false;
        window[name] = function () {
            var args = arguments;
            if (before) { var b = before.apply(this, args); if (b === false) return; }
            var r = orig.apply(this, args);
            try { if (after) after.apply(this, [r].concat(Array.prototype.slice.call(args))); } catch (e) { console.warn('ps wrap ' + name + ':', e); }
            return r;
        };
        window[name].__psOrig = orig;
        return true;
    }
    PS.wrap = wrap;

    function setupTankFormSelects() {
        var mc = $('product-category-main');
        if (mc) {
            if (mc.options[0] && mc.options[0].value === '') mc.options[0].textContent = 'نوع تیل';
            mc.onchange = function () { try { if (typeof updateSubCategories === 'function') updateSubCategories(); } catch (e) {} tankFormFuelChanged(); };
        }
        var u = $('product-unit'); if (u && u.options[0] && u.options[0].value === '') u.options[0].textContent = 'واحد شمارش اصلی';
        var su = $('product-secondary-unit'); if (su && su.options[0] && su.options[0].value === '') su.options[0].textContent = 'واحد شمارش(فرعی)';
    }
    wrap('initProductForm', function () { setupTankFormSelects(); renderTankCalc(); });
    wrap('resetProductForm', function () {
        tfSet('product-capacity', ''); tfSet('product-gravity', '');
        var fEl = $('product-secondary-unit-factor'); if (fEl) fEl.dataset.auto = '';
        // واحدِ پیش‌فرضِ ذخیرهٔ جدید = لیتر
        var u = $('product-unit');
        if (u && !u.value) { if (!Array.prototype.some.call(u.options, function (o) { return o.value === 'لیتر'; })) { var o = document.createElement('option'); o.value = o.textContent = 'لیتر'; u.appendChild(o); } u.value = 'لیتر'; }
        renderTankCalc();
    });
    wrap('loadProductData', function (r, productId) {
        var p = getProduct(productId);
        if (!p) return;
        setTimeout(function () {
            tfSet('product-capacity', N(p.capacity) ? p.capacity : '');
            tfSet('product-gravity', N(p.gravity) ? p.gravity : '');
            var fEl = $('product-secondary-unit-factor'); if (fEl) fEl.dataset.auto = '0';
            var mc = $('product-category-main');
            var fuel = tankFuel(p);
            if (mc && fuel) {
                if (!Array.prototype.some.call(mc.options, function (o) { return o.value === fuel; })) { var o = document.createElement('option'); o.value = o.textContent = fuel; mc.appendChild(o); }
                mc.value = fuel;
            }
            renderTankCalc();
        }, 0);
    });
    wrap('showProductForm', function (r, productId, opts) {
        var t = $('product-form-title');
        if (t && !productId) t.textContent = 'ثبت تیل و ذخیره';
        setupTankFormSelects();
        setTimeout(renderTankCalc, 30);
    });

    // =============================================================================
    //  لیستِ ذخایر (تبِ «ذخایر») — کارت‌ها مثلِ لیستِ اجناسِ قبلی با محتوای پمپ
    // =============================================================================
    var _origLoadProductsList = window.loadProductsList;
    function tankFill(p) {
        var cap = N(p.capacity);
        if (!(cap > 0)) return null;
        return N(p.stock) / cap * 100;
    }
    window.loadProductsList = function (productsArg) {
        try {
            try {
                if (typeof _hbEnsureSortRestoreHook === 'function') _hbEnsureSortRestoreHook();
                if (!window._productsSortKey && typeof _hbSortGet === 'function') {
                    var _sv = _hbSortGet('products');
                    if (_sv) { window._productsSortKey = _sv; window._productsShowPurchase = (_sv.indexOf('purchase') === 0); }
                }
                if (typeof _hbSortSyncMenu === 'function') _hbSortSyncMenu('products');
            } catch (e) {}
            var list = Array.isArray(productsArg) ? productsArg.slice() : products().slice();
            var tbody = document.querySelector('#products-table tbody');
            if (!tbody) return;
            var sortKey = window._productsSortKey || '';
            if (sortKey) {
                var toMs = (typeof _hbDateToMs === 'function') ? _hbDateToMs : function () { return 0; };
                list.sort(function (a, b) {
                    switch (sortKey) {
                        case 'name-asc': return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
                        case 'name-desc': return String(b.name || '').localeCompare(String(a.name || ''), 'fa');
                        case 'stock-desc': return (stockLiters(b) != null ? stockLiters(b) : N(b.stock)) - (stockLiters(a) != null ? stockLiters(a) : N(a.stock));
                        case 'stock-asc': return (stockLiters(a) != null ? stockLiters(a) : N(a.stock)) - (stockLiters(b) != null ? stockLiters(b) : N(b.stock));
                        case 'fill-desc': return (tankFill(b) || 0) - (tankFill(a) || 0);
                        case 'fill-asc': return (tankFill(a) == null ? 1e9 : tankFill(a)) - (tankFill(b) == null ? 1e9 : tankFill(b));
                        case 'price-desc': return N(b.salePriceAFN) - N(a.salePriceAFN);
                        case 'price-asc': return N(a.salePriceAFN) - N(b.salePriceAFN);
                        case 'purchase-desc': return N(b.purchasePriceAFN) - N(a.purchasePriceAFN);
                        case 'purchase-asc': return N(a.purchasePriceAFN) - N(b.purchasePriceAFN);
                        case 'new': return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0);
                        case 'old': return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
                        case 'code': return String(a.code || '').localeCompare(String(b.code || ''), 'fa', { numeric: true });
                        case 'updated': return toMs(b.updatedAt || b.createdAt) - toMs(a.updatedAt || a.createdAt);
                        default: return 0;
                    }
                });
            }
            var isPicker = false;
            try { isPicker = !!_productPickerInput; } catch (e) { isPicker = !!window._productPickerInput; }
            var showPurchase = !!window._productsShowPurchase;
            tbody.innerHTML = '';
            if (!list.length) {
                tbody.innerHTML = '<tr class="product-card-row"><td class="product-card-cell"><div class="ps-empty"><i class="fas fa-database"></i><div>هنوز هیچ ذخیره‌ای ثبت نشده است.</div><button type="button" class="ps-panel-btn" onclick="showProductForm()"><i class="fas fa-plus"></i> ثبت ذخیره و تیل</button></div></td></tr>';
            }
            var meters = getMeters();
            list.forEach(function (p) {
                var fuel = tankFuel(p);
                var col = fuelColor(fuel);
                var g = tankGravity(p);
                var fill = tankFill(p);
                var neg = N(p.stock) < 0 ? ' is-stock-neg' : '';
                var low = (fill != null && fill < 15) ? ' ps-low' : '';
                var price = (function () {
                    var sp = (p.salePrices && typeof p.salePrices === 'object') ? p.salePrices : {};
                    var codes = Object.keys(sp).filter(function (c) { return N(sp[c]) > 0; });
                    if (!codes.length && N(p.salePriceAFN) > 0) { sp = {}; sp[baseCur()] = p.salePriceAFN; codes = [baseCur()]; }
                    if (!codes.length) return '—';
                    return codes.map(function (c) { return fmt(sp[c], 4) + ' ' + esc(curLabel(c)); }).join(' / ') + ' <small class="ps-muted">/ ' + esc(p.unit || '') + '</small>';
                })();
                var purchase = '';
                if (showPurchase) {
                    var pp = (p.purchasePrices && typeof p.purchasePrices === 'object') ? p.purchasePrices : {};
                    var pc = Object.keys(pp).filter(function (c) { return N(pp[c]) > 0; });
                    if (!pc.length && N(p.purchasePriceAFN) > 0) { pp = {}; pp[baseCur()] = p.purchasePriceAFN; pc = [baseCur()]; }
                    purchase = '<div class="product-card-cell-data">قیمت خرید: <span>' + (pc.length ? pc.map(function (c) { return fmt(pp[c], 4) + ' ' + esc(curLabel(c)); }).join(' / ') : '—') + '</span></div>';
                }
                var mCount = meters.filter(function (m) { return String(m.tankId) === String(p.id); }).length;
                var actions;
                if (isPicker) {
                    var pj = JSON.stringify({ id: p.id, name: p.name }).replace(/"/g, '&quot;');
                    actions = '<button class="btn-primary" style="padding:5px 14px;font-size:12px;" onclick="event.stopPropagation();_selectProductForPicker(' + pj + ')">انتخاب</button>';
                } else {
                    actions = '<button class="product-card-kebab action-trigger-btn" type="button" onmouseenter="showProductActionBar(event, ' + p.id + ')" onmouseleave="handleProductActionBtnLeave(event)" onclick="event.stopPropagation();showProductActionBar(event, ' + p.id + ')"><i class="fas fa-ellipsis-v"></i></button>';
                }
                var tr = document.createElement('tr');
                tr.className = 'product-card-row ps-tank-row';
                tr.innerHTML =
                    '<td class="product-card-cell">' +
                    '<div class="product-card ps-tank-card' + (showPurchase ? ' with-purchase' : '') + low + '" style="--ps-fuel:' + col + '">' +
                    '<div class="product-card-main">' +
                    '<div class="product-card-img ps-tank-icon"><i class="fas fa-database"></i></div>' +
                    '<div class="product-card-name">' + esc(p.name || '') +
                    '<small class="ps-tank-sub">' + (p.code ? 'نمبر: ' + esc(p.code) + ' • ' : '') + '<span class="ps-fuel-dot"></span>' + esc(fuel || '—') + (g ? ' • ثقل ' + fmt(g, 4) : '') + '</small></div>' +
                    '</div>' +
                    '<div class="product-card-cell-data' + neg + '">موجودی: <span>' + qtyText(p, p.stock) + '</span></div>' +
                    '<div class="product-card-cell-data ps-fill-cell">' + (fill != null
                        ? '<div class="ps-fill ps-fill-sm"><div class="ps-fill-bar" style="width:' + Math.max(0, Math.min(100, fill)) + '%;"></div><span>' + fmt(fill, 1) + '٪ از ' + fmt(p.capacity) + ' ' + esc(p.unit || '') + '</span></div>'
                        : 'ظرفیت: <span>—</span>') + '</div>' +
                    purchase +
                    '<div class="product-card-cell-data">قیمت فروش: <span>' + price + '</span></div>' +
                    '<div class="product-card-cell-data ps-meter-count">میتر: <span>' + fmt(mCount, 0) + '</span></div>' +
                    '<div class="product-card-actions">' + actions + '</div>' +
                    '<span class="product-card-search" style="display:none">' + esc((p.code || '') + ' ' + fuel + ' ' + (p.unit || '')) + '</span>' +
                    '</div></td>';
                var card = tr.querySelector('.product-card');
                if (card) card.style.cursor = 'pointer';
                if (isPicker) {
                    tr.dataset.pickId = p.id;
                    tr.addEventListener('click', function () { _selectProductForPicker(p); });
                } else {
                    tr.addEventListener('click', function (e) {
                        try { if (typeof __hbFromRowMenu === 'function' && __hbFromRowMenu(e)) return; } catch (x) {}
                        if (e.target.closest('.product-card-kebab')) return;
                        if (typeof showProductInOutList === 'function') showProductInOutList(p.id);
                    });
                }
                tbody.appendChild(tr);
            });
            try { if (typeof _rpProductPick !== 'undefined' && _rpProductPick && typeof _rpDecorateProductPick === 'function') _rpDecorateProductPick(); } catch (e) {}
            // جستجوی فعال دوباره اعمال شود
            var q = $('global-search-products');
            if (q && q.value && currentTab() === 'tanks') { try { globalSearch('products'); } catch (e) {} }
            applyDigits();
        } catch (e) {
            console.error('pump loadProductsList:', e);
            if (typeof _origLoadProductsList === 'function') return _origLoadProductsList.apply(this, arguments);
        }
    };

    // ── منوی سه‌نقطهٔ ذخیره ──
    window.showProductActionBar = function (event, productId) {
        var p = getProduct(productId); if (!p) return;
        floatMenu(event, [
            { icon: 'fa-clipboard-list', color: '#1e3a5f', title: 'مشخصات ذخیره', action: 'view-detail' },
            { icon: 'fa-edit', color: '#334155', title: 'ویرایش', action: 'edit' },
            { icon: 'fa-gas-pump', color: '#16a34a', title: 'افزودن به فروش', action: 'add-to-sale' },
            { icon: 'fa-truck-droplet', color: '#2563eb', title: 'افزودن به خرید', action: 'add-to-purchase' },
            { icon: 'fa-right-left', color: '#7c3aed', title: 'انتقال به ذخیرهٔ دیگر', action: 'transfer' },
            { icon: 'fa-exchange-alt', color: '#0891b2', title: 'لیست ورودی و خروجی', action: 'in-out-list' },
            { icon: 'fa-gauge-high', color: '#d97706', title: 'میترهای این ذخیره', action: 'meters' },
            { icon: 'fa-trash', color: '#dc2626', title: 'حذف', action: 'delete' }
        ], function (a) { window.performProductAction(productId, a); });
    };
    var _origPerform = window.performProductAction;
    window.performProductAction = function (productId, action) {
        if (action === 'add-to-purchase') return addTankToBill(productId, true);
        if (action === 'add-to-sale') return addTankToBill(productId, false);
        if (action === 'transfer') return openTransfer(productId);
        if (action === 'meters') { psSwitchTab('meters'); var f = $('filter-meter-tank'); if (f) { fillMeterFilters(); f.value = String(productId); } renderMeters(); return; }
        return _origPerform.apply(this, arguments);
    };
    function addTankToBill(productId, isPurchase) {
        if (isPurchase) showPurchaseForm(); else showSalesForm();
        setTimeout(function () {
            var row = firstEmptyRow(isPurchase) || addRow(isPurchase);
            setRowTank(row, productId, {});
            focusQty(row);
        }, 180);
    }
    window.addToSale = function (productId) { addTankToBill(productId, false); };

    // =============================================================================
    //  تب‌های ذخایر / میتر + جستجو/مرتب‌سازی/فیلترِ اختصاصیِ هر تب
    // =============================================================================
    var TAB_KEY = 'apexps_products_tab';
    function currentTab() { var a = document.querySelector('#products-list .ps-tab.active'); return a ? a.getAttribute('data-pstab') : 'tanks'; }
    function setTitle(text) {
        var h = document.querySelector('#products-list .section-title-in-filter');
        if (!h) return;
        Array.prototype.slice.call(h.childNodes).forEach(function (n) { if (n.nodeType === 3) n.remove(); });
        var back = h.querySelector('.btn-back-header');
        var t = document.createTextNode(' ' + text + ' ');
        if (back) back.after(t); else h.insertBefore(t, h.firstChild);
    }
    function psSwitchTab(tab) {
        tab = (tab === 'meters') ? 'meters' : 'tanks';
        // در حالتِ انتخاب از بل، فقط تبِ ذخایر معنا دارد
        try { if (_productPickerInput && tab === 'meters') tab = 'tanks'; } catch (e) {}
        document.querySelectorAll('#products-list .ps-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-pstab') === tab); });
        var pt = $('ps-panel-tanks'), pm = $('ps-panel-meters');
        if (pt) { pt.style.display = tab === 'tanks' ? '' : 'none'; pt.classList.toggle('active', tab === 'tanks'); }
        if (pm) { pm.style.display = tab === 'meters' ? '' : 'none'; pm.classList.toggle('active', tab === 'meters'); }
        var s = $('global-search-products');
        if (s) { s.value = ''; s.placeholder = tab === 'meters' ? 'جستجوی میتر (نام، نمبر، نوع تیل، ذخیره)' : 'جستجوی ذخایر (نام، نمبر ذخیره، نوع تیل)'; }
        var tb = $('ps-transfer-btn'); if (tb) tb.style.visibility = tab === 'tanks' ? '' : 'hidden';
        var fl = $('ps-fab-label'); if (fl) fl.textContent = tab === 'meters' ? 'تعریف میتر' : 'ثبت ذخیره';
        document.querySelectorAll('.sort-menu, .filter-menu').forEach(function (m) { m.style.display = 'none'; });
        setTitle(tab === 'meters' ? 'لیست میترها' : 'لیست ذخایر');
        try { sessionStorage.setItem(TAB_KEY, tab); } catch (e) {}
        if (tab === 'meters') { fillMeterFilters(); renderMeters(); }
        else { try { loadProductsList(); } catch (e) {} }
    }
    window.psSwitchTab = psSwitchTab;
    window.psShowMetersTab = function () {
        if (sectionActive('products-list')) { psSwitchTab('meters'); return; }
        try { sessionStorage.setItem('apexps_open_meters', '1'); } catch (e) {}
        showSection('products-list');
    };
    window.psToggleSort = function () { toggleSortMenu(currentTab() === 'meters' ? 'meters' : 'products'); };
    window.psToggleFilter = function () {
        if (currentTab() === 'meters') { fillMeterFilters(); toggleFilterMenu('meters'); }
        else { try { fillTankFuelFilter(); } catch (e) {} toggleFilterMenu('products'); }
    };
    window.psSearch = function () { if (currentTab() === 'meters') renderMeters(); else globalSearch('products'); };
    window.psFabAdd = function () { if (currentTab() === 'meters') showMeterForm(); else showProductForm(); };
    function fillTankFuelFilter() {
        var sel = $('filter-product-category'); if (!sel) return;
        var cur = sel.value;
        sel.innerHTML = '<option value="all">همه</option>' + fuelTypes().map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
        if (cur) sel.value = cur;
    }

    document.addEventListener('sectionChanged', function (e) {
        var id = e && e.detail && e.detail.sectionId;
        if (id !== 'products-list') return;
        setTimeout(function () {
            var picker = false; try { picker = !!_productPickerInput; } catch (x) {}
            var want = 'tanks';
            try { if (!picker && sessionStorage.getItem('apexps_open_meters') === '1') want = 'meters'; sessionStorage.removeItem('apexps_open_meters'); } catch (x) {}
            // سازگاری با switchFinancialTab که کلاسِ active را از همهٔ .fin-tab برمی‌دارد
            psSwitchTab(want);
        }, 20);
    });

    // =============================================================================
    //  انتقالِ تیل بین ذخایر (همان رکوردِ انتقالِ برنامهٔ اصلی)
    // =============================================================================
    function openTransfer(srcId) {
        var tanks = products();
        if (tanks.length < 2) { msg('توجه', 'برای انتقال، حداقل دو ذخیره لازم است.'); return; }
        var opts = function (sel) {
            return tanks.map(function (p) {
                return '<option value="' + p.id + '"' + (String(p.id) === String(sel) ? ' selected' : '') + '>' + esc(p.name) + ' — ' + esc(tankFuel(p) || '') + ' (' + fmt(p.stock) + ' ' + esc(p.unit || '') + ')</option>';
            }).join('');
        };
        var src = srcId || tanks[0].id;
        var body =
            '<div class="ps-form-grid">' +
            '<label class="ps-lbl">از ذخیره<select id="pst-src" onchange="PumpStation.trRefresh()">' + opts(src) + '</select></label>' +
            '<label class="ps-lbl">به ذخیره<select id="pst-dst" onchange="PumpStation.trRefresh()"></select></label>' +
            '<label class="ps-lbl">مقدار<input type="number" id="pst-qty" step="any" min="0" oninput="PumpStation.trRefresh()" placeholder="مقدار"></label>' +
            '<label class="ps-lbl">واحد<select id="pst-unit" onchange="PumpStation.trRefresh()"></select></label>' +
            '<label class="ps-lbl">تاریخ<input type="text" id="pst-date" value="' + esc(nowDT()) + '"></label>' +
            '<label class="ps-lbl">یادداشت<input type="text" id="pst-note" placeholder="یادداشت (اختیاری)"></label>' +
            '</div><div class="ps-calc-box" id="pst-info"></div>';
        modal('<i class="fas fa-right-left"></i> انتقال تیل بین ذخایر', body, [
            { html: '<i class="fas fa-folder"></i> ثبت انتقال', primary: true, onClick: submitTransfer },
            { html: 'لغو', onClick: closeModal }
        ]);
        trRefresh(true);
    }
    function trRefresh(first) {
        var src = getProduct(tfVal('pst-src'));
        var dstSel = $('pst-dst'), unitSel = $('pst-unit');
        if (!src || !dstSel || !unitSel) return;
        var cands = products().filter(function (p) { return String(p.id) !== String(src.id); });
        var keep = dstSel.value;
        dstSel.innerHTML = cands.map(function (p) {
            var ok = (tankFuel(p) === tankFuel(src));
            return '<option value="' + p.id + '"' + (ok ? '' : ' disabled') + '>' + esc(p.name) + ' — ' + esc(tankFuel(p) || '') + (ok ? '' : ' (نوع تیل متفاوت)') + '</option>';
        }).join('');
        if (keep && Array.prototype.some.call(dstSel.options, function (o) { return o.value === keep && !o.disabled; })) dstSel.value = keep;
        else { var firstOk = Array.prototype.find.call(dstSel.options, function (o) { return !o.disabled; }); if (firstOk) dstSel.value = firstOk.value; }
        var keepU = unitSel.value;
        unitSel.innerHTML = unitsForTank(src).filter(function (u) { return primaryPerUnit(src, u, tankGravity(src)) != null; })
            .map(function (u) { return '<option value="' + esc(u) + '">' + esc(u) + '</option>'; }).join('');
        unitSel.value = (keepU && !first) ? keepU : (src.unit || 'لیتر');
        var dst = getProduct(dstSel.value);
        var qty = N(tfVal('pst-qty'));
        var ppu = primaryPerUnit(src, unitSel.value, tankGravity(src)) || 0;
        var qSrc = qty * ppu;
        var info = [];
        info.push('<div class="ps-calc-row"><span>موجودیِ ذخیرهٔ مبدأ</span><b>' + qtyText(src, src.stock) + '</b></div>');
        if (dst) {
            info.push('<div class="ps-calc-row"><span>موجودیِ ذخیرهٔ مقصد</span><b>' + qtyText(dst, dst.stock) + '</b></div>');
            if (N(dst.capacity) > 0) info.push('<div class="ps-calc-row"><span>ظرفیتِ خالیِ مقصد</span><b>' + qtyText(dst, N(dst.capacity) - N(dst.stock)) + '</b></div>');
            if (dst.unit !== src.unit) info.push('<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> واحدِ اصلیِ دو ذخیره متفاوت است؛ مقدار به لیتر تبدیل و در مقصد ثبت می‌شود.</div>');
        }
        if (qty > 0) {
            var L = stockLiters(src, qSrc);
            info.push('<div class="ps-calc-row"><span>مقدارِ انتقال</span><b>' + fmt(qSrc) + ' ' + esc(src.unit || '') + ((L != null && unitLiters(src.unit, 1) !== 1) ? ' = ' + fmt(L) + ' لیتر' : '') + '</b></div>');
            if (qSrc > N(src.stock) + 1e-9) info.push('<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> مقدار از موجودیِ ذخیرهٔ مبدأ بیشتر است.</div>');
        }
        var box = $('pst-info'); if (box) box.innerHTML = info.join('');
        applyDigits();
    }
    PS.trRefresh = trRefresh;
    function submitTransfer() {
        var src = getProduct(tfVal('pst-src')), dst = getProduct(tfVal('pst-dst'));
        var qty = N(tfVal('pst-qty')), unit = tfVal('pst-unit');
        if (!src || !dst) { msg('خطا', 'ذخیرهٔ مبدأ و مقصد را انتخاب کنید.'); return; }
        if (String(src.id) === String(dst.id)) { msg('خطا', 'ذخیرهٔ مبدأ و مقصد نمی‌توانند یکی باشند.'); return; }
        if (tankFuel(src) !== tankFuel(dst)) { msg('خطا', 'نوع تیلِ دو ذخیره یکسان نیست؛ انتقال ممکن نیست.'); return; }
        if (!(qty > 0)) { msg('خطا', 'مقدارِ انتقال باید بزرگ‌تر از صفر باشد.'); return; }
        var ppu = primaryPerUnit(src, unit, tankGravity(src));
        if (ppu == null) { msg('خطا', 'تبدیلِ این واحد ممکن نیست؛ ثقل یا واحد را بررسی کنید.'); return; }
        var qSrc = R(qty * ppu, 6);
        if (qSrc > N(src.stock) + 1e-9) { msg('خطا', 'موجودیِ ذخیرهٔ مبدأ کافی نیست (موجودی: ' + fmt(src.stock) + ' ' + (src.unit || '') + ').'); return; }
        // اگر واحدِ اصلیِ مقصد فرق دارد، فقط وقتی هر دو حجمی‌اند مجاز است
        var qDst = qSrc;
        if (dst.unit !== src.unit) {
            var Ls = stockLiters(src, qSrc), Ld1 = unitLiters(dst.unit, tankGravity(dst));
            if (Ls == null || Ld1 == null) { msg('خطا', 'واحدِ اصلیِ دو ذخیره متفاوت و غیرقابلِ تبدیل است.'); return; }
            qDst = R(Ls / Ld1, 6);
            // رکوردِ انتقالِ برنامه یک «مقدار» برای هر دو طرف دارد؛ برای حفظِ دقت، مقصد باید هم‌واحد باشد
            msg('توجه', 'برای انتقال بین دو ذخیره با واحدِ اصلیِ متفاوت، ابتدا واحدِ اصلیِ هر دو را یکسان (مثلاً لیتر) کنید.');
            return;
        }
        var go = function () {
            // ارزشِ تمام‌شدهٔ واحد (همان منطقِ انتقالِ گدام)
            var unitCost = 0;
            try {
                var fm = (typeof _getFifoMaps === 'function') ? _getFifoMaps() : null;
                var iv = fm && fm.invBaseByProd ? fm.invBaseByProd[src.id] : null;
                if (iv != null && N(src.stock) > 1e-9) unitCost = N(iv) / N(src.stock);
                if (!(unitCost > 0) && db.getPurchasePrice) unitCost = N(db.getPurchasePrice(src, baseCur()));
            } catch (e) { unitCost = 0; }
            // میانگینِ وزنیِ قیمتِ خریدِ مقصد (حفظِ سرمایه — همان منطقِ برنامهٔ اصلی)
            try {
                var raw = db.getAllProducts();
                var di = raw.findIndex(function (p) { return p.id == dst.id; });
                if (di !== -1) {
                    var dS = N(raw[di].stock), den = dS + qSrc;
                    if (den > 0) {
                        var sA = N(src.purchasePriceAFN), dA = N(raw[di].purchasePriceAFN);
                        if (sA !== dA) { raw[di].purchasePriceAFN = (dS * dA + qSrc * sA) / den; localStorage.setItem('products', JSON.stringify(raw)); }
                    }
                }
            } catch (e) {}
            db.adjustProductStockById(src.id, -qSrc);
            db.adjustProductStockById(dst.id, qSrc);
            var rec = {
                date: tfVal('pst-date') || nowDT(),
                fromId: src.warehouseId || 'wh_main', fromName: src.name,
                toId: dst.warehouseId || 'wh_main', toName: dst.name,
                note: tfVal('pst-note'),
                tankTransfer: true,
                enteredQty: qty, enteredUnit: unit,
                items: [{ srcProductId: src.id, destProductId: dst.id, name: src.name, unit: src.unit || '', quantity: qSrc,
                    unitCostBase: unitCost, costBase: unitCost * qSrc, liters: stockLiters(src, qSrc), fuelType: tankFuel(src) }]
            };
            var r = db.saveTransfer(rec);
            if (!r || r.success === false) { msg('خطا', (r && r.error) || 'خطا در ثبت انتقال'); return; }
            try { addChangelog('ثبت', 'انتقال', rec, 'انتقال ' + fmt(qty) + ' ' + unit + ' ' + tankFuel(src) + ' از «' + src.name + '» به «' + dst.name + '»'); } catch (e) {}
            closeModal();
            try { loadProductsList(); } catch (e) {}
            try { if (typeof loadDashboard === 'function') loadDashboard(); } catch (e) {}
            try {
                if (sectionActive('product-inout-list') && window._currentInoutProductId != null) showProductInOutList(window._currentInoutProductId);
            } catch (e) {}
            toast('انتقال با موفقیت ثبت شد');
        };
        if (N(dst.capacity) > 0 && N(dst.stock) + qDst > N(dst.capacity) + 1e-9) {
            ask('هشدار ظرفیت', 'با این انتقال، موجودیِ «' + dst.name + '» از ظرفیتِ آن بیشتر می‌شود. ادامه می‌دهید؟', go);
        } else go();
    }
    window.psOpenTransfer = function (srcId) { openTransfer(srcId); };
    PS.openTransfer = openTransfer;

    // =============================================================================
    //  میتر: تعریف / ویرایش / حذف / لیست (تبِ «میتر»)
    // =============================================================================
    var _meterEditId = null, _meterReturn = null;
    function fillFuelSelect(sel, value, placeholder) {
        if (!sel) return;
        sel.innerHTML = '<option value="">' + esc(placeholder || 'نوع تیل') + '</option>' +
            fuelTypes().map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
        if (value) {
            if (!Array.prototype.some.call(sel.options, function (o) { return o.value === value; })) { var o = document.createElement('option'); o.value = o.textContent = value; sel.appendChild(o); }
            sel.value = value;
        }
    }
    function fillTankSelect(sel, fuel, value, placeholder) {
        if (!sel) return;
        var list = products().filter(function (p) { return !fuel || tankFuel(p) === fuel; });
        sel.innerHTML = '<option value="">' + esc(placeholder || 'ذخیره مربوطه') + '</option>' +
            list.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + (p.code ? ' (' + esc(p.code) + ')' : '') + '</option>'; }).join('');
        if (value != null && value !== '') sel.value = String(value);
    }
    function showMeterForm(id, opts) {
        _meterEditId = id || null;
        _meterReturn = (opts && opts.returnTo) || null;
        var m = id ? getMeter(id) : null;
        var t = $('meter-form-title'); if (t) t.textContent = m ? 'ویرایش میتر' : 'تعریف میتر';
        var b = $('meter-submit-btn'); if (b) b.innerHTML = '<i class="fas fa-folder"></i> ' + (m ? 'ذخیره تغییرات' : 'ثبت');
        tfSet('meter-name', m ? m.name : '');
        tfSet('meter-number', m ? m.number : '');
        tfSet('meter-initial-reading', m ? m.initialReading : '');
        tfSet('meter-date', m ? (m.date || '') : nowDT());
        var fuel = m ? m.fuelType : '';
        var presetTank = (opts && opts.tankId) ? getProduct(opts.tankId) : null;
        if (!m && presetTank) fuel = tankFuel(presetTank);
        fillFuelSelect($('meter-fuel'), fuel);
        fillTankSelect($('meter-tank'), fuel, m ? m.tankId : (presetTank ? presetTank.id : ''));
        // اگر برای این میتر قرائت ثبت شده، قرائتِ ابتدایی با احتیاط ویرایش شود
        var ir = $('meter-initial-reading');
        var hasR = m ? readingsOf(m.id).length > 0 : false;
        var hint = $('ps-meter-hint');
        if (hint) hint.innerHTML = hasR
            ? '<div class="ps-calc-warn"><i class="fas fa-circle-info"></i> برای این میتر ' + fmt(readingsOf(m.id).length, 0) + ' قرائت ثبت شده است؛ تغییرِ قرائتِ ابتدایی، مقدارِ مصرفِ قرائتِ نخست را دوباره محاسبه می‌کند.</div>'
            : '<div class="ps-calc-hint"><i class="fas fa-circle-info"></i> قرائتِ ابتدایی = عددِ شمارشگرِ میتر هنگامِ شروع (مثلاً ۱۰۰۰). مقدارِ مصرفِ هر قرائت = قرائتِ فعلی − قرائتِ قبلی.</div>';
        if (ir) ir.readOnly = false;
        showSection('meter-form');
        applyDigits();
    }
    window.showMeterForm = function (id, opts) { showMeterForm(id, opts); };
    window.psMeterFormFuelChanged = function () {
        var fuel = tfVal('meter-fuel');
        var keep = tfVal('meter-tank');
        fillTankSelect($('meter-tank'), fuel, keep);
        var sel = $('meter-tank');
        if (sel && !sel.value) {
            var c = products().filter(function (p) { return tankFuel(p) === fuel; });
            if (c.length === 1) sel.value = String(c[0].id);
        }
    };
    window.psMeterFormTankChanged = function () {
        var p = getProduct(tfVal('meter-tank'));
        if (p && !tfVal('meter-fuel')) { fillFuelSelect($('meter-fuel'), tankFuel(p)); fillTankSelect($('meter-tank'), tankFuel(p), p.id); }
    };
    window.psMeterFormBack = function () {
        var r = _meterReturn; _meterReturn = null;
        if (r) { showSection(r); return; }
        try { sessionStorage.setItem('apexps_open_meters', '1'); } catch (e) {}
        showSection('products-list');
    };
    function saveMeter() {
        var name = String(tfVal('meter-name')).trim();
        var number = toEn(String(tfVal('meter-number')).trim());
        var fuel = tfVal('meter-fuel');
        var tankId = tfVal('meter-tank');
        var irStr = tfVal('meter-initial-reading');
        var ir = N(toEn(irStr));
        var date = toEn(tfVal('meter-date')) || nowDT();
        if (!name) { msg('خطا', 'لطفاً نام میتر را وارد کنید.'); return; }
        if (!number) { msg('خطا', 'لطفاً نمبر میتر را وارد کنید.'); return; }
        if (!fuel) { msg('خطا', 'لطفاً نوع تیل را انتخاب کنید.'); return; }
        if (!tankId) { msg('خطا', 'لطفاً ذخیرهٔ مربوطه را انتخاب کنید.'); return; }
        if (irStr === '' || ir < 0) { msg('خطا', 'قرائتِ ابتدایی را درست وارد کنید (صفر یا بیشتر).'); return; }
        var tank = getProduct(tankId);
        if (tank && tankFuel(tank) !== fuel) { msg('خطا', 'نوع تیلِ میتر با نوع تیلِ ذخیرهٔ مربوطه یکسان نیست.'); return; }
        var list = getMeters();
        if (list.some(function (m) { return String(m.number).trim() === number && String(m.id) !== String(_meterEditId); })) { msg('خطا', 'این نمبر میتر قبلاً ثبت شده است.'); return; }
        var now = nowDT();
        var rec;
        if (_meterEditId) {
            var idx = list.findIndex(function (m) { return String(m.id) === String(_meterEditId); });
            if (idx === -1) { msg('خطا', 'میتر یافت نشد.'); return; }
            var first = readingsOf(_meterEditId)[0];
            if (first && ir > N(first.currentReading)) { msg('خطا', 'قرائتِ ابتدایی نمی‌تواند از نخستین قرائتِ ثبت‌شده (' + fmt(first.currentReading) + ') بیشتر باشد.'); return; }
            rec = Object.assign({}, list[idx], { name: name, number: number, fuelType: fuel, tankId: tank ? tank.id : tankId, tankName: tank ? tank.name : '', initialReading: ir, date: date, updatedAt: now });
            list[idx] = rec;
        } else {
            rec = { id: newId(), name: name, number: number, fuelType: fuel, tankId: tank ? tank.id : tankId, tankName: tank ? tank.name : '', initialReading: ir, date: date, createdAt: now, updatedAt: now };
            list.push(rec);
        }
        saveMetersList(list);
        if (_meterEditId) {
            // نام/نمبرِ میتر روی قرائت‌ها هم به‌روز شود + زنجیرهٔ مصرف
            var rs = getReadings();
            rs.forEach(function (r) { if (String(r.meterId) === String(rec.id)) { r.meterName = rec.name; r.meterNumber = rec.number; r.fuelType = rec.fuelType; r.tankId = rec.tankId; } });
            saveReadingsList(rs);
            rechain(rec.id);
        }
        try { addChangelog(_meterEditId ? 'ویرایش' : 'ثبت', 'میتر', rec, (_meterEditId ? 'ویرایش' : 'تعریف') + ' میتر ' + rec.name + ' (' + rec.number + ')'); } catch (e) {}
        var wasEdit = !!_meterEditId;
        _meterEditId = null;
        toast(wasEdit ? 'میتر ویرایش شد' : 'میتر با موفقیت ثبت شد');
        var r = _meterReturn; _meterReturn = null;
        if (r === 'meter-reading-form') { showMeterReadingForm(rec.id); return; }
        try { sessionStorage.setItem('apexps_open_meters', '1'); } catch (e) {}
        showSection('products-list');
    }
    window.saveMeter = saveMeter;
    function deleteMeter(id) {
        var m = getMeter(id); if (!m) return;
        var rc = readingsOf(id).length;
        ask('حذف میتر', 'میتر «' + m.name + '» ' + (rc ? 'و ' + rc + ' قرائتِ آن ' : '') + 'حذف شود؟ (بل‌های فروشِ ثبت‌شده باقی می‌مانند)', function () {
            saveMetersList(getMeters().filter(function (x) { return String(x.id) !== String(id); }));
            saveReadingsList(getReadings().filter(function (r) { return String(r.meterId) !== String(id); }));
            try { addChangelog('حذف', 'میتر', m, 'حذف میتر ' + m.name); } catch (e) {}
            renderMeters();
            toast('میتر حذف شد');
        });
    }
    PS.deleteMeter = deleteMeter;

    var _meterSort = '';
    try { _meterSort = (typeof _hbSortGet === 'function' ? _hbSortGet('meters') : '') || ''; } catch (e) {}
    window.psSortMeters = function (v) { _meterSort = v || ''; try { _hbSortSet('meters', _meterSort); } catch (e) {} renderMeters(); };
    function fillMeterFilters() {
        var f = $('filter-meter-fuel'), t = $('filter-meter-tank');
        if (f) { var fv = f.value; f.innerHTML = '<option value="all">همه</option>' + fuelTypes().map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join(''); if (fv) f.value = fv; }
        if (t) { var tv = t.value; t.innerHTML = '<option value="all">همه</option>' + products().map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join(''); if (tv) t.value = tv; }
    }
    function readingToday(m) {
        var d = today();
        return readingsOf(m.id).filter(function (r) { return String(r.date || '').split(' ')[0] === d; });
    }
    function renderMeters() {
        var tbody = document.querySelector('#meters-table tbody'); if (!tbody) return;
        var q = String(($('global-search-products') || {}).value || '').toLowerCase().trim();
        var ff = ($('filter-meter-fuel') || {}).value || 'all';
        var ft = ($('filter-meter-tank') || {}).value || 'all';
        var fs = ($('filter-meter-status') || {}).value || 'all';
        var list = getMeters().filter(function (m) {
            if (ff !== 'all' && m.fuelType !== ff) return false;
            if (ft !== 'all' && String(m.tankId) !== String(ft)) return false;
            if (fs === 'today' && !readingToday(m).length) return false;
            if (fs === 'pending' && readingToday(m).length) return false;
            if (fs === 'diff') { var lr = lastReadingOf(m.id); if (!lr || Math.abs(N(lr.diffLiters)) < 0.001) return false; }
            if (q) {
                var tank = getProduct(m.tankId);
                var hay = [m.name, m.number, m.fuelType, tank ? tank.name : m.tankName].join(' ').toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
        var sk = _meterSort || 'new';
        var ss = $('sort-menu-meters') && $('sort-menu-meters').querySelector('select'); if (ss && _meterSort) ss.value = _meterSort;
        list.sort(function (a, b) {
            switch (sk) {
                case 'old': return N(a.id) - N(b.id);
                case 'name-asc': return String(a.name).localeCompare(String(b.name), 'fa');
                case 'number': return String(a.number).localeCompare(String(b.number), 'fa', { numeric: true });
                case 'reading-desc': return meterCurrentReading(b) - meterCurrentReading(a);
                case 'reading-asc': return meterCurrentReading(a) - meterCurrentReading(b);
                case 'last-reading': var la = lastReadingOf(a.id), lb = lastReadingOf(b.id); return N(lb && lb.at) - N(la && la.at);
                default: return N(b.id) - N(a.id);
            }
        });
        tbody.innerHTML = '';
        if (!list.length) {
            tbody.innerHTML = '<tr class="product-card-row"><td class="product-card-cell"><div class="ps-empty"><i class="fas fa-gauge-high"></i><div>' + (getMeters().length ? 'میتری با این جستجو/فیلتر پیدا نشد.' : 'هنوز هیچ میتری تعریف نشده است.') + '</div><button type="button" class="ps-panel-btn" onclick="showMeterForm()"><i class="fas fa-plus"></i> تعریف میتر</button></div></td></tr>';
            return;
        }
        list.forEach(function (m) {
            var tank = getProduct(m.tankId);
            var lr = lastReadingOf(m.id);
            var td = readingToday(m).reduce(function (s, r) { return s + N(r.dispensed); }, 0);
            var col = fuelColor(m.fuelType);
            var tr = document.createElement('tr');
            tr.className = 'product-card-row ps-meter-row';
            tr.innerHTML =
                '<td class="product-card-cell"><div class="product-card ps-tank-card ps-meter-card" style="--ps-fuel:' + col + ';cursor:pointer;">' +
                '<div class="product-card-main"><div class="product-card-img ps-tank-icon"><i class="fas fa-gauge-high"></i></div>' +
                '<div class="product-card-name">' + esc(m.name) + '<small class="ps-tank-sub">نمبر: ' + esc(m.number) + ' • <span class="ps-fuel-dot"></span>' + esc(m.fuelType || '') + '</small></div></div>' +
                '<div class="product-card-cell-data">ذخیره: <span>' + esc(tank ? tank.name : (m.tankName || '—')) + '</span></div>' +
                '<div class="product-card-cell-data">قرائت فعلی: <span>' + fmt(meterCurrentReading(m)) + '</span></div>' +
                '<div class="product-card-cell-data">آخرین قرائت: <span>' + (lr ? esc(String(lr.date || '').split(' ')[0]) : '—') + '</span></div>' +
                '<div class="product-card-cell-data">مصرف امروز: <span>' + fmt(td) + ' لیتر</span></div>' +
                (lr && Math.abs(N(lr.diffLiters)) >= 0.001 ? '<div class="product-card-cell-data ' + (N(lr.diffLiters) > 0 ? 'ps-diff-pos' : 'ps-diff-neg') + '">تفاوت آخر: <span>' + fmt(lr.diffLiters) + ' لیتر</span></div>' : '<div class="product-card-cell-data">تفاوت آخر: <span>—</span></div>') +
                '<div class="product-card-actions"><button class="product-card-kebab action-trigger-btn" type="button" onmouseenter="PumpStation.meterMenu(event,' + m.id + ')" onmouseleave="handleProductActionBtnLeave(event)" onclick="event.stopPropagation();PumpStation.meterMenu(event,' + m.id + ')"><i class="fas fa-ellipsis-v"></i></button></div>' +
                '</div></td>';
            tr.addEventListener('click', function (e) {
                try { if (typeof __hbFromRowMenu === 'function' && __hbFromRowMenu(e)) return; } catch (x) {}
                if (e.target.closest('.product-card-kebab')) return;
                showReadingsList(m.id);
            });
            tbody.appendChild(tr);
        });
        applyDigits();
    }
    window.psRenderMeters = renderMeters;
    PS.renderMeters = renderMeters;
    PS.fillMeterFilters = fillMeterFilters;
    PS.meterMenu = function (event, id) {
        floatMenu(event, [
            { icon: 'fa-clipboard-list', color: '#1e3a5f', title: 'مشخصات میتر', action: 'detail' },
            { icon: 'fa-edit', color: '#334155', title: 'ویرایش', action: 'edit' },
            { icon: 'fa-gas-pump', color: '#16a34a', title: 'قرائت جدید', action: 'reading' },
            { icon: 'fa-list-check', color: '#0891b2', title: 'لیست قرائت‌ها', action: 'list' },
            { icon: 'fa-trash', color: '#dc2626', title: 'حذف', action: 'delete' }
        ], function (a) {
            if (a === 'detail') meterDetail(id);
            else if (a === 'edit') showMeterForm(id);
            else if (a === 'reading') showMeterReadingForm(id);
            else if (a === 'list') showReadingsList(id);
            else if (a === 'delete') deleteMeter(id);
        });
    };
    function meterDetail(id) {
        var m = getMeter(id); if (!m) return;
        var tank = getProduct(m.tankId);
        var rs = readingsOf(id);
        var totalDisp = rs.reduce(function (s, r) { return s + N(r.dispensed); }, 0);
        var totalBilled = rs.reduce(function (s, r) { return s + N(r.billedLiters); }, 0);
        var totalDiff = rs.reduce(function (s, r) { return s + N(r.diffLiters); }, 0);
        var row = function (l, v) { return '<div class="ps-calc-row"><span>' + l + '</span><b>' + v + '</b></div>'; };
        var body = '<div class="ps-detail">' +
            row('نام میتر', esc(m.name)) + row('نمبر میتر', esc(m.number)) + row('نوع تیل', esc(m.fuelType || '—')) +
            row('ذخیره مربوطه', esc(tank ? tank.name : (m.tankName || '—'))) + row('تاریخ ثبت', esc(m.date || '—')) +
            row('قرائت ابتدایی', fmt(m.initialReading)) + row('قرائت فعلی', fmt(meterCurrentReading(m))) +
            row('تعداد قرائت‌ها', fmt(rs.length, 0)) + row('مجموع مقدار مصرف', fmt(totalDisp) + ' لیتر') +
            row('فروشِ ثبت‌شده با این میتر', fmt(totalBilled) + ' لیتر') +
            row('مجموع تفاوت', '<span class="' + (totalDiff > 0 ? 'ps-diff-pos' : (totalDiff < 0 ? 'ps-diff-neg' : '')) + '">' + fmt(totalDiff) + ' لیتر</span>') +
            '</div>';
        modal('<i class="fas fa-gauge-high"></i> مشخصات میتر', body, [
            { html: '<i class="fas fa-gas-pump"></i> قرائت جدید', primary: true, onClick: function () { closeModal(); showMeterReadingForm(id); } },
            { html: '<i class="fas fa-list-check"></i> لیست قرائت‌ها', onClick: function () { closeModal(); showReadingsList(id); } }
        ]);
    }
    PS.meterDetail = meterDetail;

    // =============================================================================
    //  قرائتِ میتر: فورم + تحلیل (مقدار مصرف، فروش ثبت‌شده، تفاوت) + ثبتِ فروشِ نقدیِ تفاوت
    // =============================================================================
    var _readingEditId = null, _readingReturn = null;
    function showMeterReadingForm(meterId, readingId) {
        if (!getMeters().length) {
            ask('میتر تعریف نشده', 'هنوز هیچ میتری تعریف نشده است. اکنون میتر تعریف شود؟', function () { showMeterForm(null, { returnTo: 'meter-reading-form' }); });
            return;
        }
        var cur = document.querySelector('.section.active');
        _readingReturn = (cur && cur.id !== 'meter-reading-form') ? cur.id : (_readingReturn || 'dashboard');
        _readingEditId = readingId || null;
        var rec = readingId ? getReadings().find(function (r) { return String(r.id) === String(readingId); }) : null;
        var sel = $('mr-meter');
        if (sel) {
            sel.innerHTML = '<option value="">انتخاب میتر</option>' + getMeters().map(function (m) {
                return '<option value="' + m.id + '">' + esc(m.name) + ' — ' + esc(m.number) + ' (' + esc(m.fuelType || '') + ')</option>';
            }).join('');
            sel.value = rec ? String(rec.meterId) : (meterId ? String(meterId) : (getMeters().length === 1 ? String(getMeters()[0].id) : ''));
            sel.disabled = !!rec;
        }
        tfSet('mr-date', rec ? rec.date : nowDT());
        tfSet('mr-current', rec ? rec.currentReading : '');
        tfSet('mr-shift', rec ? (rec.shift || '') : '');
        tfSet('mr-notes', rec ? (rec.notes || '') : '');
        tfSet('mr-price', rec ? (rec.pricePerLiter || '') : '');
        var as = $('mr-autosale'); if (as) { as.checked = false; as.disabled = !!(rec && rec.autoSaleId); }
        var cb = $('mr-cashbox');
        if (cb) {
            var boxes = []; try { boxes = db.getCashboxes() || []; } catch (e) {}
            cb.innerHTML = '<option value="">حساب</option>' + boxes.map(function (b) { return '<option value="' + b.id + '">' + esc(b.name) + '</option>'; }).join('');
            try { var dId = getDefaultCashboxIdForCurrency(baseCur()); if (dId) cb.value = String(dId); } catch (e) {}
            if (!cb.value && boxes.length === 1) cb.value = String(boxes[0].id);
        }
        var t = $('meter-reading-form-title'); if (t) t.textContent = rec ? 'ویرایش قرائت میتر' : 'قرائت میتر';
        var b = $('mr-submit-btn'); if (b) b.innerHTML = '<i class="fas fa-folder"></i> ' + (rec ? 'ذخیره تغییرات' : 'ثبت');
        showSection('meter-reading-form');
        readingMeterChanged(true);
    }
    window.showMeterReadingForm = function (meterId, readingId) { showMeterReadingForm(meterId, readingId); };
    window.psReadingFormBack = function () { var r = _readingReturn || 'dashboard'; _readingReturn = null; showSection(r); if (r === 'products-list') setTimeout(function () { psSwitchTab('meters'); }, 40); };
    function readingMeterChanged(keepPrice) {
        var m = getMeter(tfVal('mr-meter'));
        var tank = m ? getProduct(m.tankId) : null;
        var at = dateMs(toEn(tfVal('mr-date'))) || Date.now();
        var prev = m ? lastReadingOf(m.id, at, _readingEditId) : null;
        tfSet('mr-prev', m ? (prev ? N(prev.currentReading) : N(m.initialReading)) : '');
        tfSet('mr-tank', tank ? tank.name + ' — ' + tankFuel(tank) : (m ? (m.tankName || '') : ''));
        if (m && tank && (!keepPrice || !tfVal('mr-price'))) {
            // قیمتِ فروشِ هر لیتر (ارزِ اصلی)
            var p1 = 0;
            try { var r = _resolveProductPrice(tank, baseCur(), 'sale', 'primary'); p1 = N(r && r.price); } catch (e) { p1 = N(tank.salePriceAFN); }
            var Lp = unitLiters(tank.unit, tankGravity(tank)) || 1;
            if (p1 > 0) tfSet('mr-price', R(p1 / Lp, 4));
        }
        readingRecalc();
    }
    window.psReadingMeterChanged = function () { readingMeterChanged(false); };
    function readingAnalysis() {
        var m = getMeter(tfVal('mr-meter'));
        if (!m) return null;
        var at = dateMs(toEn(tfVal('mr-date'))) || Date.now();
        var prevRec = lastReadingOf(m.id, at, _readingEditId);
        var prev = prevRec ? N(prevRec.currentReading) : N(m.initialReading);
        var prevAt = prevRec ? N(prevRec.at) : dateMs(m.date || m.createdAt);
        var curStr = tfVal('mr-current');
        var cur = N(toEn(curStr));
        var disp = R(cur - prev, 3);
        var billed = R(billedLiters(m.id, prevAt, at, _readingEditId), 3);
        var diff = R(disp - billed, 3);
        var price = N(toEn(tfVal('mr-price')));
        var tank = getProduct(m.tankId);
        return { meter: m, tank: tank, at: at, prev: prev, prevAt: prevAt, cur: cur, hasCur: curStr !== '', dispensed: disp, billed: billed, diff: diff, price: price, value: R(diff * price, 2) };
    }
    function readingRecalc() {
        var box = $('mr-analysis'); if (!box) return;
        var a = readingAnalysis();
        var asw = $('mr-autosale-wrap');
        if (!a) { box.innerHTML = '<div class="ps-calc-hint"><i class="fas fa-circle-info"></i> میتر را انتخاب کنید.</div>'; if (asw) asw.style.display = 'none'; return; }
        var row = function (l, v, cls) { return '<div class="ps-calc-row' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b>' + v + '</b></div>'; };
        var h = '<div class="ps-analysis-title"><i class="fas fa-chart-simple"></i> تحلیلِ قرائت (' + esc(a.meter.name) + ')</div>';
        h += row('قرائت قبلی', fmt(a.prev));
        if (a.hasCur) {
            if (a.cur < a.prev) h += '<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> قرائتِ فعلی از قرائتِ قبلی کمتر است.</div>';
            h += row('مقدار مصرف (قرائت فعلی − قرائت قبلی)', fmt(a.dispensed) + ' لیتر', 'ps-strong');
            h += row('فروشِ ثبت‌شده با این میتر در همین دوره', fmt(a.billed) + ' لیتر');
            var dcls = a.diff > 0.0005 ? 'ps-diff-pos' : (a.diff < -0.0005 ? 'ps-diff-neg' : '');
            var dtxt = a.diff > 0.0005 ? 'فروشِ ثبت‌نشده (نقدی)' : (a.diff < -0.0005 ? 'بیشتر از میتر ثبت شده (کسری)' : 'مطابق');
            h += row('تفاوت — ' + dtxt, '<span class="' + dcls + '">' + fmt(a.diff) + ' لیتر</span>');
            if (a.price > 0) h += row('ارزشِ تفاوت (' + fmt(a.price, 4) + ' فی لیتر)', fmt(a.value, 2) + ' ' + esc(curLabel(baseCur())));
            if (a.tank) {
                var stL = stockLiters(a.tank);
                if (stL != null) {
                    h += row('موجودیِ فعلیِ ذخیره «' + esc(a.tank.name) + '»', fmt(stL) + ' لیتر');
                    if (a.diff > 0 && a.diff > stL + 1e-6) h += '<div class="ps-calc-warn"><i class="fas fa-triangle-exclamation"></i> مقدارِ فروش‌نشده از موجودیِ ذخیره بیشتر است.</div>';
                }
            }
        }
        box.innerHTML = h;
        var canAuto = a.hasCur && a.diff > 0.0005 && !_readingEditId;
        if (asw) asw.style.display = canAuto ? '' : 'none';
        var cbw = $('mr-autosale-cashbox-wrap');
        if (cbw) cbw.style.display = (canAuto && $('mr-autosale') && $('mr-autosale').checked) ? '' : 'none';
        applyDigits();
    }
    window.psReadingRecalc = readingRecalc;

    function generalCustomer() {
        var persons = []; try { persons = db.getPersons() || []; } catch (e) {}
        var p = persons.find(function (x) { return x && String(x.name).trim() === 'مشتری عمومی'; });
        if (p) return p;
        var r = db.savePerson({ name: 'مشتری عمومی', category: 'مشتری', phone: '', notes: 'ساخته‌شده توسط سیستم برای فروشِ نقدیِ قرائتِ میتر' });
        return (r && r.data) || null;
    }
    // فروشِ نقدیِ «تفاوتِ میتر» — دقیقاً هم‌ساختارِ بلِ فروشِ معمولی
    function createAutoSale(a, readingId, cashboxId) {
        var tank = a.tank; if (!tank) return null;
        var cust = generalCustomer(); if (!cust) return null;
        var cur = baseCur();
        var Lp = unitLiters(tank.unit, tankGravity(tank)) || 1;
        var qtyPrimary = R(a.diff / Lp, 6);
        var total = R(a.diff * a.price, 2);
        if (!(qtyPrimary > 0) || !(total > 0)) return null;
        var pricePrimary = total / qtyPrimary;
        var item = {
            productId: parseInt(tank.id, 10) || tank.id, productName: tank.name, isService: false,
            quantity: qtyPrimary, unit: tank.unit || 'لیتر', price: pricePrimary, discount: 0, total: total,
            unitType: 'primary', secondaryFactor: 0,
            fuelType: tankFuel(tank), tankId: tank.id, tankName: tank.name, meterId: a.meter.id, meterName: a.meter.name, meterNumber: a.meter.number,
            gravity: tankGravity(tank), enteredQty: a.diff, enteredUnit: 'لیتر', enteredPrice: a.price, liters: a.diff
        };
        try { var snap = _saleCostSnapshot(tank, qtyPrimary, 'primary', 0); if (snap) { item.purchasePriceAFN = snap.purchasePriceAFN; item.purchasePriceUSD = snap.purchasePriceUSD; } } catch (e) {}
        var date = toEn(tfVal('mr-date')) || nowDT();
        var bill = db.generateBillNumber('فروش');
        var tx = {
            type: 'فروش', customerId: parseInt(cust.id, 10) || cust.id, customerName: cust.name, date: date, billNumber: bill, currency: cur, saleType: 'نقد',
            items: [item], subTotal: total, totalDiscount: 0, totalAmount: total, cashAfn: total, cashUsd: 0, cashForeign: 0, cashForeignCurrency: null, remaining: 0,
            notes: 'فروش نقدی — تفاوتِ قرائتِ میتر ' + a.meter.name + ' (' + a.meter.number + ')',
            cashAmounts: (function () { try { return _buildCashAmounts(cur, total, 0, 0); } catch (e) { var o = {}; o[cur] = total; return o; } })(),
            rateUsed: (function () { try { return _dayRateFor(cur); } catch (e) { return null; } })(),
            baseCurrency: cur, profit: 0, cashboxId: cashboxId ? parseInt(cashboxId, 10) : null,
            status: 'تسویه‌شده', createdAt: new Date().toISOString(), psAutoReadingId: readingId
        };
        try {
            var pp = N(_resolveProductPrice(tank, cur, 'purchase', 'primary').price);
            tx.profit = R((pricePrimary - pp) * qtyPrimary, 2);
        } catch (e) {}
        var res = db.saveTransaction(tx);
        if (!res || res.success === false) { msg('خطا', (res && res.error) || 'خطا در ثبتِ فروشِ نقدی'); return null; }
        try {
            if (cashboxId) _logCashboxTransaction(parseInt(cashboxId, 10), { type: 'sale', amount: total, currency: cur, datetime: date, notes: tx.notes, description: 'فروش — بل ' + bill + ' — ' + cust.name });
        } catch (e) {}
        try { addChangelog('ثبت', 'فروش', tx, 'فروش نقدیِ تفاوتِ میتر ' + a.meter.name); } catch (e) {}
        return res.data || tx;
    }
    function saveMeterReading() {
        var a = readingAnalysis();
        if (!a) { msg('خطا', 'لطفاً میتر را انتخاب کنید.'); return; }
        if (!a.hasCur) { msg('خطا', 'لطفاً قرائتِ فعلی را وارد کنید.'); return; }
        if (a.cur < a.prev) { msg('خطا', 'قرائتِ فعلی (' + fmt(a.cur) + ') نمی‌تواند از قرائتِ قبلی (' + fmt(a.prev) + ') کمتر باشد.'); return; }
        // قرائتِ بعدی (در ویرایش یا ثبتِ تاریخِ گذشته) نباید از این قرائت کمتر شود
        var next = readingsOf(a.meter.id).filter(function (r) { return N(r.at) > a.at && String(r.id) !== String(_readingEditId); })[0];
        if (next && N(next.currentReading) < a.cur) { msg('خطا', 'قرائتِ بعدیِ ثبت‌شده (' + fmt(next.currentReading) + ' در ' + String(next.date).split(' ')[0] + ') از این عدد کمتر است.'); return; }
        var auto = !!($('mr-autosale') && $('mr-autosale').checked) && a.diff > 0.0005 && !_readingEditId;
        var cashboxId = tfVal('mr-cashbox');
        if (auto && !cashboxId) { msg('خطا', 'برای ثبتِ فروشِ نقدی، حساب را انتخاب کنید.'); return; }
        if (auto && !(a.price > 0)) { msg('خطا', 'برای ثبتِ فروشِ نقدی، قیمتِ فی لیتر را وارد کنید.'); return; }
        var list = getReadings();
        var now = nowDT();
        var rec;
        if (_readingEditId) {
            var idx = list.findIndex(function (r) { return String(r.id) === String(_readingEditId); });
            if (idx === -1) { msg('خطا', 'قرائت یافت نشد.'); return; }
            rec = Object.assign(list[idx], {
                date: toEn(tfVal('mr-date')) || list[idx].date, at: a.at, currentReading: a.cur, pricePerLiter: a.price,
                shift: tfVal('mr-shift'), notes: tfVal('mr-notes'), updatedAt: now
            });
        } else {
            rec = {
                id: newId(), meterId: a.meter.id, meterName: a.meter.name, meterNumber: a.meter.number, fuelType: a.meter.fuelType, tankId: a.meter.tankId,
                date: toEn(tfVal('mr-date')) || now, at: a.at, prevReading: a.prev, currentReading: a.cur, dispensed: a.dispensed,
                billedLiters: a.billed, diffLiters: a.diff, pricePerLiter: a.price, diffValue: a.value,
                shift: tfVal('mr-shift'), notes: tfVal('mr-notes'), autoSaleId: null, createdAt: now, createdAtMs: Date.now(), updatedAt: now
            };
            list.push(rec);
        }
        saveReadingsList(list);
        if (auto) {
            var sale = createAutoSale(a, rec.id, cashboxId);
            if (sale) {
                var l2 = getReadings(); var r2 = l2.find(function (x) { return String(x.id) === String(rec.id); });
                if (r2) { r2.autoSaleId = sale.id; r2.autoSaleBill = sale.billNumber; saveReadingsList(l2); }
            }
        }
        rechain(a.meter.id);
        try { addChangelog(_readingEditId ? 'ویرایش' : 'ثبت', 'قرائت میتر', rec, 'قرائت میتر ' + a.meter.name + ': ' + fmt(a.prev) + ' → ' + fmt(a.cur) + ' (' + fmt(a.dispensed) + ' لیتر)'); } catch (e) {}
        var wasEdit = !!_readingEditId;
        _readingEditId = null;
        var sel = $('mr-meter'); if (sel) sel.disabled = false;
        toast(wasEdit ? 'قرائت ویرایش شد' : ('قرائت ثبت شد — مقدار مصرف: ' + fmt(a.dispensed) + ' لیتر'));
        try { if (typeof loadDashboard === 'function') loadDashboard(); } catch (e) {}
        var r = _readingReturn || 'dashboard'; _readingReturn = null;
        if (r === 'meter-readings-list') { showSection(r); return; }
        showSection(r);
        if (r === 'products-list') setTimeout(function () { psSwitchTab('meters'); }, 40);
    }
    window.saveMeterReading = saveMeterReading;
    function deleteReading(id) {
        var rec = getReadings().find(function (r) { return String(r.id) === String(id); }); if (!rec) return;
        var extra = rec.autoSaleId ? ' (بلِ فروشِ نقدیِ مربوط «' + (rec.autoSaleBill || rec.autoSaleId) + '» باقی می‌ماند؛ در صورتِ نیاز آن را از لیستِ فروش حذف کنید)' : '';
        ask('حذف قرائت', 'قرائتِ ' + String(rec.date || '').split(' ')[0] + ' میتر «' + (rec.meterName || '') + '» حذف شود؟' + extra, function () {
            saveReadingsList(getReadings().filter(function (r) { return String(r.id) !== String(id); }));
            rechain(rec.meterId);
            try { addChangelog('حذف', 'قرائت میتر', rec, 'حذف قرائت میتر ' + (rec.meterName || '')); } catch (e) {}
            renderReadings();
            try { if (typeof loadDashboard === 'function') loadDashboard(); } catch (e) {}
            toast('قرائت حذف شد');
        });
    }
    PS.deleteReading = deleteReading;

    // =============================================================================
    //  لیستِ قرائتِ میتر
    // =============================================================================
    // showSection متنِ عنوانِ بخش‌های ناشناخته را پاک می‌کند؛ این‌جا برگردانده می‌شود
    function fixListTitle(secId, text) {
        var h = document.querySelector('#' + secId + ' .section-title-in-filter'); if (!h) return;
        Array.prototype.slice.call(h.childNodes).forEach(function (n) { if (n.nodeType === 3) n.remove(); });
        var back = h.querySelector('.btn-back-header');
        var t = document.createTextNode(' ' + text + ' ');
        if (back) back.after(t); else h.insertBefore(t, h.firstChild);
    }
    var _readingsMeterFilter = null, _readingsReturn = null;
    function showReadingsList(meterId) {
        var cur = document.querySelector('.section.active');
        _readingsReturn = (cur && cur.id !== 'meter-readings-list') ? cur.id : _readingsReturn;
        _readingsMeterFilter = meterId || null;
        showSection('meter-readings-list');
    }
    PS.showReadingsList = showReadingsList;
    window.psReadingsListBack = function () {
        var r = _readingsReturn || 'dashboard'; _readingsReturn = null; _readingsMeterFilter = null;
        if (r === 'products-list') { try { sessionStorage.setItem('apexps_open_meters', '1'); } catch (e) {} }
        showSection(r);
    };
    function fillReadingFilters() {
        var fm = $('mrl-filter-meter'), ff = $('mrl-filter-fuel');
        if (fm) { var v = fm.value; fm.innerHTML = '<option value="all">همه</option>' + getMeters().map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + ' (' + esc(m.number) + ')</option>'; }).join(''); fm.value = _readingsMeterFilter ? String(_readingsMeterFilter) : (v || 'all'); }
        if (ff) { var v2 = ff.value; ff.innerHTML = '<option value="all">همه</option>' + fuelTypes().map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join(''); if (v2) ff.value = v2; }
    }
    function filteredReadings() {
        var q = String(($('global-search-meter-readings') || {}).value || '').toLowerCase().trim();
        var fm = ($('mrl-filter-meter') || {}).value || 'all';
        var ff = ($('mrl-filter-fuel') || {}).value || 'all';
        var from = dateMs(toEn(($('mrl-filter-from') || {}).value || ''));
        var to = dateMs(toEn(($('mrl-filter-to') || {}).value || ''));
        if (to) to += 86399999;
        var list = getReadings().filter(function (r) {
            if (fm !== 'all' && String(r.meterId) !== String(fm)) return false;
            if (ff !== 'all' && r.fuelType !== ff) return false;
            if (from && N(r.at) < from) return false;
            if (to && N(r.at) > to) return false;
            if (q) { var hay = [r.meterName, r.meterNumber, r.fuelType, r.date, r.shift, r.notes].join(' ').toLowerCase(); if (hay.indexOf(q) === -1) return false; }
            return true;
        });
        var sk = ($('mrl-sort') || {}).value || 'date-desc';
        list.sort(function (a, b) {
            switch (sk) {
                case 'date-asc': return N(a.at) - N(b.at);
                case 'disp-desc': return N(b.dispensed) - N(a.dispensed);
                case 'disp-asc': return N(a.dispensed) - N(b.dispensed);
                case 'diff-desc': return Math.abs(N(b.diffLiters)) - Math.abs(N(a.diffLiters));
                default: return N(b.at) - N(a.at);
            }
        });
        return list;
    }
    function renderReadings() {
        var tbody = document.querySelector('#meter-readings-table tbody'); if (!tbody) return;
        var list = filteredReadings();
        var lbl = $('mrl-meter-label');
        var fm = ($('mrl-filter-meter') || {}).value || 'all';
        var mm = fm !== 'all' ? getMeter(fm) : null;
        if (lbl) { lbl.style.display = mm ? '' : 'none'; lbl.textContent = mm ? mm.name : ''; }
        var sum = list.reduce(function (s, r) { s.d += N(r.dispensed); s.b += N(r.billedLiters); s.x += N(r.diffLiters); s.v += N(r.diffValue); return s; }, { d: 0, b: 0, x: 0, v: 0 });
        var sb = $('mrl-summary');
        if (sb) sb.innerHTML = list.length ? (
            '<div class="ps-sum-chip"><span>تعداد قرائت</span><b>' + fmt(list.length, 0) + '</b></div>' +
            '<div class="ps-sum-chip"><span>مجموع مقدار مصرف</span><b>' + fmt(sum.d) + ' لیتر</b></div>' +
            '<div class="ps-sum-chip"><span>فروش ثبت‌شده</span><b>' + fmt(sum.b) + ' لیتر</b></div>' +
            '<div class="ps-sum-chip ' + (sum.x > 0 ? 'ps-diff-pos' : (sum.x < 0 ? 'ps-diff-neg' : '')) + '"><span>تفاوت</span><b>' + fmt(sum.x) + ' لیتر</b></div>' +
            '<div class="ps-sum-chip"><span>ارزش تفاوت</span><b>' + fmt(sum.v, 2) + ' ' + esc(curLabel(baseCur())) + '</b></div>') : '';
        tbody.innerHTML = '';
        if (!list.length) { tbody.innerHTML = '<tr class="sales-card-row"><td><div class="ps-empty"><i class="fas fa-gas-pump"></i><div>قرائتی ثبت نشده است.</div><button type="button" class="ps-panel-btn" onclick="showMeterReadingForm(' + (mm ? mm.id : '') + ')"><i class="fas fa-plus"></i> قرائت جدید</button></div></td></tr>'; return; }
        list.forEach(function (r) {
            var tr = document.createElement('tr');
            tr.className = 'sales-card-row ps-reading-row';
            var dcls = N(r.diffLiters) > 0.0005 ? 'ps-diff-pos' : (N(r.diffLiters) < -0.0005 ? 'ps-diff-neg' : '');
            tr.innerHTML = '<td><div class="ps-reading-card">' +
                '<div class="ps-rc-main"><i class="fas fa-gauge-high"></i><div><b>' + esc(r.meterName || '') + '</b><small>' + esc(r.meterNumber || '') + ' • ' + esc(r.fuelType || '') + '</small></div></div>' +
                '<div class="ps-rc-cell"><span>تاریخ</span><b>' + esc(String(r.date || '').split(' ')[0]) + '</b></div>' +
                '<div class="ps-rc-cell"><span>قرائت قبلی</span><b>' + fmt(r.prevReading) + '</b></div>' +
                '<div class="ps-rc-cell"><span>قرائت فعلی</span><b>' + fmt(r.currentReading) + '</b></div>' +
                '<div class="ps-rc-cell"><span>مقدار مصرف</span><b>' + fmt(r.dispensed) + ' لیتر</b></div>' +
                '<div class="ps-rc-cell"><span>فروش ثبت‌شده</span><b>' + fmt(r.billedLiters) + '</b></div>' +
                '<div class="ps-rc-cell ' + dcls + '"><span>تفاوت</span><b>' + fmt(r.diffLiters) + '</b></div>' +
                '<div class="ps-rc-cell"><span>بل نقدی</span><b>' + (r.autoSaleBill ? esc(r.autoSaleBill) : '—') + '</b></div>' +
                '<div class="ps-rc-actions"><button class="product-card-kebab action-trigger-btn" type="button" onclick="event.stopPropagation();PumpStation.readingMenu(event,' + r.id + ')"><i class="fas fa-ellipsis-v"></i></button></div>' +
                '</div></td>';
            tr.addEventListener('click', function (e) { if (e.target.closest('.product-card-kebab')) return; readingDetail(r.id); });
            tbody.appendChild(tr);
        });
        applyDigits();
    }
    window.psRenderReadings = renderReadings;
    window.psResetReadingsFilter = function () {
        ['mrl-filter-from', 'mrl-filter-to'].forEach(function (i) { tfSet(i, ''); });
        ['mrl-filter-meter', 'mrl-filter-fuel'].forEach(function (i) { var e = $(i); if (e) e.value = 'all'; });
        _readingsMeterFilter = null; renderReadings();
    };
    PS.readingMenu = function (event, id) {
        var rec = getReadings().find(function (r) { return String(r.id) === String(id); }); if (!rec) return;
        var acts = [
            { icon: 'fa-clipboard-list', color: '#1e3a5f', title: 'جزئیات قرائت', action: 'detail' },
            { icon: 'fa-edit', color: '#334155', title: 'ویرایش', action: 'edit' }
        ];
        if (rec.autoSaleId) acts.push({ icon: 'fa-file-invoice', color: '#16a34a', title: 'نمایش بل فروش نقدی', action: 'sale' });
        acts.push({ icon: 'fa-trash', color: '#dc2626', title: 'حذف', action: 'delete' });
        floatMenu(event, acts, function (a) {
            if (a === 'detail') readingDetail(id);
            else if (a === 'edit') showMeterReadingForm(rec.meterId, id);
            else if (a === 'sale') { try { showTxDetail(rec.autoSaleId, 'meter-readings-list'); } catch (e) { msg('خطا', 'بل یافت نشد.'); } }
            else if (a === 'delete') deleteReading(id);
        });
    };
    function readingDetail(id) {
        var r = getReadings().find(function (x) { return String(x.id) === String(id); }); if (!r) return;
        var row = function (l, v) { return '<div class="ps-calc-row"><span>' + l + '</span><b>' + v + '</b></div>'; };
        var tank = getProduct(r.tankId);
        var body = '<div class="ps-detail">' + row('میتر', esc(r.meterName) + ' (' + esc(r.meterNumber) + ')') + row('نوع تیل', esc(r.fuelType || '—')) +
            row('ذخیره', esc(tank ? tank.name : '—')) + row('تاریخ', esc(r.date || '')) + row('قرائت قبلی', fmt(r.prevReading)) + row('قرائت فعلی', fmt(r.currentReading)) +
            row('مقدار مصرف', fmt(r.dispensed) + ' لیتر') + row('فروش ثبت‌شده با میتر', fmt(r.billedLiters) + ' لیتر') +
            row('تفاوت', fmt(r.diffLiters) + ' لیتر') + row('قیمت فی لیتر', fmt(r.pricePerLiter, 4)) + row('ارزش تفاوت', fmt(r.diffValue, 2) + ' ' + esc(curLabel(baseCur()))) +
            row('بل فروش نقدی', r.autoSaleBill ? esc(r.autoSaleBill) : '—') + row('شیفت / مسئول', esc(r.shift || '—')) + row('یادداشت', esc(r.notes || '—')) + '</div>';
        modal('<i class="fas fa-gas-pump"></i> جزئیات قرائت میتر', body, [
            { html: '<i class="fas fa-edit"></i> ویرایش', primary: true, onClick: function () { closeModal(); showMeterReadingForm(r.meterId, r.id); } },
            { html: 'بستن', onClick: closeModal }
        ]);
    }
    window.psExportReadingsExcel = function () {
        try {
            if (typeof XLSX === 'undefined') { msg('خطا', 'کتابخانهٔ اکسل هنوز بارگذاری نشده است.'); return; }
            var list = filteredReadings();
            if (!list.length) { msg('اطلاع', 'قرائتی برای خروجی وجود ندارد.'); return; }
            var aoa = [['تاریخ', 'نام میتر', 'نمبر میتر', 'نوع تیل', 'قرائت قبلی', 'قرائت فعلی', 'مقدار مصرف (لیتر)', 'فروش ثبت‌شده (لیتر)', 'تفاوت (لیتر)', 'قیمت فی لیتر', 'ارزش تفاوت', 'بل نقدی', 'شیفت', 'یادداشت']];
            list.forEach(function (r) { aoa.push([r.date, r.meterName, r.meterNumber, r.fuelType, N(r.prevReading), N(r.currentReading), N(r.dispensed), N(r.billedLiters), N(r.diffLiters), N(r.pricePerLiter), N(r.diffValue), r.autoSaleBill || '', r.shift || '', r.notes || '']); });
            var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = aoa[0].map(function () { return { wch: 16 }; });
            var wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
            XLSX.utils.book_append_sheet(wb, ws, 'قرائت میتر');
            var fname = 'قرائت_میتر'; try { fname += '_' + new PersianDate().format('YYYYMMDD_HHmmss'); } catch (e) { fname += '_' + Date.now(); }
            XLSX.writeFile(wb, fname + '.xlsx');
            try { if (typeof _rpAfterExcelSaved === 'function') _rpAfterExcelSaved(fname + '.xlsx'); } catch (e) {}
        } catch (e) { msg('خطا', 'خطا در ساخت فایل اکسل: ' + (e && e.message ? e.message : e)); }
    };

    document.addEventListener('sectionChanged', function (e) {
        var id = e && e.detail && e.detail.sectionId;
        if (id === 'meter-readings-list') { setTimeout(function () { fixListTitle('meter-readings-list', 'لیست قرائت میتر'); fillReadingFilters(); renderReadings(); }, 20); }
        if (id === 'meter-reading-form' || id === 'meter-form') { var q = document.querySelector('.quick-actions'); if (q) q.style.display = 'none'; }
    });

    // =============================================================================
    //  بل فروش / بل خرید — سطرهای کارتی:
    //  نوع تیل | مقدار | واحد | ثقل | قیمت | مجموعه | لیتر | انتخاب میتر (فروش) | انتخاب ذخیره
    //  عناصرِ پنهانِ هر سطر (item-product / item-quantity / item-price / …) همان کلاس‌هایی
    //  هستند که saveSale / savePurchase / editTransaction می‌خوانند؛ پس منطقِ ثبت دست‌نخورده است.
    // =============================================================================
    function rowSel(isP) { return isP ? '.purchase-item-row' : '.item-row'; }
    function bodyOf(isP) { return $(isP ? 'purchase-items-body' : 'sales-items-body'); }
    function hidProd(row, isP) { return row.querySelector(isP ? '.purchase-item-product' : '.item-product'); }
    function hidQty(row, isP) { return row.querySelector(isP ? '.purchase-item-quantity' : '.item-quantity'); }
    function hidPrice(row, isP) { return row.querySelector(isP ? '.purchase-item-price' : '.item-price'); }
    function totalEl(row, isP) { return row.querySelector(isP ? '.purchase-item-total' : '.item-total'); }
    function isPRow(row) { return row.classList.contains('purchase-item-row'); }
    function billCurrency(isP) { var e = $(isP ? 'purchase-currency' : 'sales-currency'); return (e && e.value) || baseCur(); }

    function rowHtml(isP) {
        var meterField = isP ? '' :
            '<label class="ps-f ps-f-meter" title="انتخاب میتر"><i class="fas fa-calculator"></i><select class="ps-meter" onchange="PumpStation.meterChanged(this)"><option value="">انتخاب میتر</option></select></label>';
        var tankField =
            '<label class="ps-f ps-f-tank" title="انتخاب ذخیره"><i class="fas fa-database"></i><select class="ps-tank" onchange="PumpStation.tankChanged(this)"><option value="">انتخاب ذخیره</option></select></label>';
        var hidden = isP
            ? '<input type="hidden" class="purchase-item-product"><input type="hidden" class="purchase-item-quantity" value="0"><input type="hidden" class="purchase-item-unit" value=""><input type="hidden" class="purchase-item-price" value=""><input type="hidden" class="purchase-item-discount" value="0">'
            : '<input type="hidden" class="item-product"><input type="hidden" class="item-quantity" value="0"><span class="item-unit" style="display:none;"></span><input type="hidden" class="item-price" value=""><input type="hidden" class="item-discount" value="0">';
        return '<td class="ps-num-cell"><span class="ps-num">1</span>' +
            '<button type="button" class="ps-row-add" onclick="PumpStation.addRowAfter(this)" title="افزودن سطر"><i class="fas fa-plus"></i></button>' +
            '<button type="button" class="ps-row-del" onclick="' + (isP ? 'removePurchaseItem(this)' : 'removeItem(this)') + '" title="حذف سطر"><i class="fas fa-trash"></i></button></td>' +
            '<td class="ps-fields-cell"><div class="ps-grid' + (isP ? ' ps-grid-purchase' : '') + '">' +
            '<label class="ps-f ps-f-fuel" title="نوع تیل"><i class="fas fa-droplet"></i><select class="ps-fuel" onchange="PumpStation.fuelChanged(this)"><option value="">نوع تیل</option></select></label>' +
            '<label class="ps-f" title="مقدار"><i class="fas fa-list-ol"></i><input type="number" class="ps-qty" step="any" min="0" placeholder="مقدار" oninput="PumpStation.recalc(this)" onchange="PumpStation.recalc(this)"></label>' +
            '<label class="ps-f" title="واحد"><i class="far fa-clone"></i><select class="ps-unit" onchange="PumpStation.unitChanged(this)"><option value="">واحد</option></select></label>' +
            '<label class="ps-f" title="ثقل"><i class="fas fa-scale-balanced"></i><input type="number" class="ps-gravity" step="any" min="0" placeholder="ثقل" oninput="PumpStation.gravityChanged(this)" onchange="PumpStation.gravityChanged(this)"></label>' +
            '<label class="ps-f ps-f-price" title="قیمت"><i class="fas fa-circle-dollar-to-slot"></i><input type="number" class="ps-price" step="any" min="0" placeholder="قیمت" oninput="PumpStation.priceTyped(this)" onchange="PumpStation.priceTyped(this)"></label>' +
            '<div class="ps-f ps-f-ro" title="مجموعه"><i class="fas fa-cube"></i><span class="ps-ph">مجموعه</span><span class="' + (isP ? 'purchase-item-total' : 'item-total') + ' ps-total-val" data-raw="0"></span></div>' +
            '<div class="ps-f ps-f-ro" title="لیتر"><i class="fas fa-filter"></i><span class="ps-ph">لیتر</span><span class="ps-liters"></span></div>' +
            meterField + tankField +
            '</div>' +
            '<div class="product-search-wrapper" style="display:none;"><input type="text" class="product-search-input" tabindex="-1" autocomplete="off"><div class="product-search-results"></div></div>' +
            hidden + '<div class="ps-row-hint"></div></td>';
    }
    function fillRowFuel(row) {
        var sel = row.querySelector('.ps-fuel'); if (!sel) return;
        var v = sel.value;
        sel.innerHTML = '<option value="">نوع تیل</option>' + fuelTypes().map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
        if (v) sel.value = v;
    }
    function fillRowTanks(row) {
        var sel = row.querySelector('.ps-tank'); if (!sel) return;
        var fuel = (row.querySelector('.ps-fuel') || {}).value || '';
        var v = sel.value || (hidProd(row, isPRow(row)) || {}).value || '';
        var list = products().filter(function (p) { return !fuel || tankFuel(p) === fuel; });
        sel.innerHTML = '<option value="">انتخاب ذخیره</option>' + list.map(function (p) {
            return '<option value="' + p.id + '">' + esc(p.name) + ' — ' + esc(tankFuel(p) || '') + ' (موجودی: ' + fmt(p.stock) + ' ' + esc(p.unit || '') + ')</option>';
        }).join('');
        if (v && Array.prototype.some.call(sel.options, function (o) { return o.value === String(v); })) sel.value = String(v);
    }
    function fillRowMeters(row) {
        var sel = row.querySelector('.ps-meter'); if (!sel) return;
        var fuel = (row.querySelector('.ps-fuel') || {}).value || '';
        var tankId = (row.querySelector('.ps-tank') || {}).value || '';
        var v = sel.value;
        var list = getMeters().filter(function (m) { return (!fuel || m.fuelType === fuel) && (!tankId || String(m.tankId) === String(tankId)); });
        sel.innerHTML = '<option value="">انتخاب میتر</option>' + list.map(function (m) { return '<option value="' + m.id + '">' + esc(m.name) + ' — ' + esc(m.number) + '</option>'; }).join('');
        if (v && Array.prototype.some.call(sel.options, function (o) { return o.value === String(v); })) sel.value = v;
    }
    function fillRowUnits(row, prod) {
        var sel = row.querySelector('.ps-unit'); if (!sel) return;
        var v = sel.value;
        var units = unitsForTank(prod);
        sel.innerHTML = units.map(function (u) { return '<option value="' + esc(u) + '">' + esc(u) + '</option>'; }).join('');
        if (v && units.indexOf(v) !== -1) sel.value = v;
        else sel.value = (prod && prod.unit) || 'لیتر';
    }
    function initRow(row) {
        fillRowFuel(row); fillRowTanks(row); fillRowMeters(row); fillRowUnits(row, null);
    }
    function makeRow(isP) {
        var tr = document.createElement('tr');
        tr.className = (isP ? 'purchase-item-row' : 'item-row') + ' ps-row';
        tr.dataset.unitType = 'primary';
        tr.dataset.secondaryFactor = '';
        tr.innerHTML = rowHtml(isP);
        initRow(tr);
        return tr;
    }
    function renumber(isP) {
        var rows = Array.prototype.slice.call(document.querySelectorAll('#' + (isP ? 'purchase' : 'sales') + '-items-body ' + rowSel(isP)));
        var n = 0;
        rows.forEach(function (r) {
            var c = r.cells && r.cells[0];
            if (r.dataset && r.dataset.wastage === '1') { if (c) { var s0 = c.querySelector('.ps-num'); if (s0) s0.textContent = '—'; else c.textContent = '—'; } return; }
            n += 1;
            if (c) { var s = c.querySelector('.ps-num'); if (s) s.textContent = n; else c.textContent = n; }
        });
        var tb = bodyOf(isP); if (tb) tb.classList.toggle('ps-single', n <= 1);
    }
    function addRow(isP) {
        var tb = bodyOf(isP); if (!tb) return null;
        var tr = makeRow(isP);
        tb.appendChild(tr);
        renumber(isP);
        applyDigits();
        return tr;
    }
    function firstEmptyRow(isP) {
        var rows = document.querySelectorAll('#' + (isP ? 'purchase' : 'sales') + '-items-body ' + rowSel(isP));
        for (var i = 0; i < rows.length; i++) {
            var h = hidProd(rows[i], isP);
            var fuel = rows[i].querySelector('.ps-fuel');
            if (h && !h.value && !(fuel && fuel.value)) return rows[i];
        }
        return null;
    }
    function focusQty(row) { setTimeout(function () { var q = row && row.querySelector('.ps-qty'); if (q) { q.focus(); try { q.select(); } catch (e) {} } }, 30); }

    // ── جایگزینیِ توابعِ ساختِ سطر ──
    window.addSalesItem = function () { return addRow(false); };
    window.addPurchaseItem = function () { return addRow(true); };
    window.updateRowNumbers = function () { renumber(false); };
    window.updatePurchaseRowNumbers = function () { renumber(true); };
    PS.addRowAfter = function (btn) {
        var row = btn.closest('tr'); var isP = isPRow(row);
        var tr = makeRow(isP);
        row.parentNode.insertBefore(tr, row.nextSibling);
        renumber(isP); applyDigits();
        var f = tr.querySelector('.ps-fuel'); if (f) setTimeout(function () { f.focus(); }, 20);
    };
    function clearRow(row) {
        var isP = isPRow(row);
        ['.ps-fuel', '.ps-qty', '.ps-gravity', '.ps-price'].forEach(function (s) { var e = row.querySelector(s); if (e) e.value = ''; });
        var h = hidProd(row, isP); if (h) h.value = '';
        var si = row.querySelector('.product-search-input'); if (si) si.value = '';
        var q = hidQty(row, isP); if (q) q.value = '0';
        var p = hidPrice(row, isP); if (p) p.value = '';
        var t = totalEl(row, isP); if (t) { t.dataset.raw = 0; t.textContent = ''; }
        var l = row.querySelector('.ps-liters'); if (l) l.textContent = '';
        var tk = row.querySelector('.ps-tank'); if (tk) tk.value = '';
        var m = row.querySelector('.ps-meter'); if (m) m.value = '';
        delete row.dataset.psManualPrice; delete row.dataset.psGravityManual;
        initRow(row);
    }
    var _origRemoveItem = window.removeItem, _origRemovePurchaseItem = window.removePurchaseItem;
    window.removeItem = function (btn) {
        var row = btn && btn.closest('.item-row');
        if (row && row.classList.contains('ps-row')) {
            var all = document.querySelectorAll('#sales-items-body .item-row');
            if (all.length > 1) row.remove(); else clearRow(row);
            renumber(false); calculateSalesTotal(); return;
        }
        return _origRemoveItem.apply(this, arguments);
    };
    window.removePurchaseItem = function (btn) {
        var row = btn && btn.closest('.purchase-item-row');
        if (row && row.classList.contains('ps-row')) {
            var all = document.querySelectorAll('#purchase-items-body .purchase-item-row');
            if (all.length > 1) row.remove(); else clearRow(row);
            renumber(true); calculatePurchaseTotal(); return;
        }
        return _origRemovePurchaseItem.apply(this, arguments);
    };

    // ── رویدادهای سطر ──
    PS.fuelChanged = function (sel) {
        var row = sel.closest('tr');
        var fuel = sel.value;
        var tk = row.querySelector('.ps-tank');
        var cur = getProduct(tk && tk.value);
        if (cur && tankFuel(cur) !== fuel) { tk.value = ''; setRowTankId(row, ''); }
        fillRowTanks(row);
        // اگر فقط یک ذخیره از این نوع تیل هست، خودکار انتخاب شود
        var cands = products().filter(function (p) { return tankFuel(p) === fuel; });
        if (tk && !tk.value && cands.length === 1) { tk.value = String(cands[0].id); setRowTank(row, cands[0].id, { keepQty: true }); return; }
        var g = row.querySelector('.ps-gravity');
        if (g && !row.dataset.psGravityManual) g.value = defaultGravity(fuel) || '';
        fillRowMeters(row);
        recalcRow(row);
    };
    PS.tankChanged = function (sel) { var row = sel.closest('tr'); setRowTank(row, sel.value, { keepQty: true }); };
    PS.meterChanged = function (sel) {
        var row = sel.closest('tr');
        var m = getMeter(sel.value);
        if (m && m.tankId) {
            var tk = row.querySelector('.ps-tank');
            if (tk && String(tk.value) !== String(m.tankId)) {
                var f = row.querySelector('.ps-fuel'); if (f && m.fuelType) { f.value = m.fuelType; fillRowTanks(row); }
                setRowTank(row, m.tankId, { keepQty: true, keepMeter: true });
                sel = row.querySelector('.ps-meter'); if (sel) sel.value = String(m.id);
            }
        }
    };
    PS.unitChanged = function (sel) {
        var row = sel.closest('tr');
        // قیمتِ پیشنهادی هم با واحدِ جدید هماهنگ شود (مگر کاربر قیمت را دستی تغییر داده باشد)
        if (!row.dataset.psManualPrice) suggestPrice(row);
        recalcRow(row);
    };
    PS.gravityChanged = function (inp) {
        var row = inp.closest('tr'); row.dataset.psGravityManual = '1';
        if (!row.dataset.psManualPrice) suggestPrice(row);
        recalcRow(row);
    };
    PS.priceTyped = function (inp) { var row = inp.closest('tr'); row.dataset.psManualPrice = '1'; recalcRow(row); };
    PS.recalc = function (inp) { recalcRow(inp.closest('tr')); };

    function setRowTankId(row, id) {
        var isP = isPRow(row);
        var h = hidProd(row, isP); if (h) h.value = id || '';
        var p = getProduct(id);
        var si = row.querySelector('.product-search-input'); if (si) si.value = p ? p.name : '';
        if (isP) { var u = row.querySelector('.purchase-item-unit'); if (u) u.value = p ? (p.unit || '') : ''; }
        else { var us = row.querySelector('.item-unit'); if (us) us.textContent = p ? (p.unit || '') : ''; }
    }
    // انتخابِ ذخیره برای یک سطر (از انتخابگر، ذخایر، میتر، ویرایشِ بل یا افزودن به فروش/خرید)
    function setRowTank(row, id, opts) {
        opts = opts || {};
        var p = getProduct(id);
        setRowTankId(row, p ? p.id : '');
        var f = row.querySelector('.ps-fuel');
        if (p && f) { fillRowFuel(row); var fu = tankFuel(p); if (fu && !Array.prototype.some.call(f.options, function (o) { return o.value === fu; })) { var o = document.createElement('option'); o.value = o.textContent = fu; f.appendChild(o); } f.value = fu; }
        fillRowTanks(row);
        var tk = row.querySelector('.ps-tank'); if (tk) tk.value = p ? String(p.id) : '';
        var g = row.querySelector('.ps-gravity');
        if (g && p && !opts.keepGravity) { g.value = tankGravity(p) || ''; delete row.dataset.psGravityManual; }
        if (!opts.keepUnit) { var us = row.querySelector('.ps-unit'); if (us) us.value = ''; }
        fillRowUnits(row, p);
        if (!opts.keepMeter) {
            fillRowMeters(row);
            var ms = row.querySelector('.ps-meter');
            if (ms && p) { var mm = getMeters().filter(function (m) { return String(m.tankId) === String(p.id); }); if (mm.length === 1 && !ms.value) ms.value = String(mm[0].id); }
        } else fillRowMeters(row);
        if (!opts.keepPrice) { delete row.dataset.psManualPrice; suggestPrice(row); }
        var q = row.querySelector('.ps-qty'); if (q && !q.value && !opts.keepQty) q.value = '';
        recalcRow(row);
    }
    PS.setRowTank = setRowTank;
    // قیمتِ پیشنهادی = قیمتِ فروش/خریدِ ذخیره (ارزِ بل) × (لیترِ واحدِ واردشده ÷ لیترِ واحدِ اصلی)
    function suggestPrice(row) {
        if (window._billHydrating) return;
        var isP = isPRow(row);
        var p = getProduct((hidProd(row, isP) || {}).value);
        var pe = row.querySelector('.ps-price'); if (!p || !pe) return;
        var unit = (row.querySelector('.ps-unit') || {}).value || p.unit;
        var g = N((row.querySelector('.ps-gravity') || {}).value) || tankGravity(p);
        var ppu = primaryPerUnit(p, unit, g);
        var base = 0;
        try { var r = _resolveProductPrice(p, billCurrency(isP), isP ? 'purchase' : 'sale', 'primary'); base = N(r && r.price); } catch (e) { base = N(isP ? p.purchasePriceAFN : p.salePriceAFN); }
        pe.value = (base > 0 && ppu != null) ? R(base * ppu, 4) : (base > 0 && unit === p.unit ? base : '');
    }
    // بازمحاسبهٔ کاملِ یک سطر → فیلدهای پنهانِ هسته + مجموعه + لیتر
    function recalcRow(row) {
        if (!row) return;
        var isP = isPRow(row);
        var p = getProduct((hidProd(row, isP) || {}).value);
        var qty = N((row.querySelector('.ps-qty') || {}).value);
        var unit = (row.querySelector('.ps-unit') || {}).value || (p && p.unit) || 'لیتر';
        var fuel = (row.querySelector('.ps-fuel') || {}).value || '';
        var gIn = N((row.querySelector('.ps-gravity') || {}).value);
        var g = gIn || (p ? tankGravity(p) : defaultGravity(fuel));
        var price = N((row.querySelector('.ps-price') || {}).value);
        var total = R(qty * price, 6);
        var Le = p ? litersPerUnit(p, unit, g) : unitLiters(unit, g);
        var liters = (Le != null) ? qty * Le : null;
        var ppu = p ? primaryPerUnit(p, unit, g) : null;
        var hint = row.querySelector('.ps-row-hint');
        var hints = [];
        if (!p && (qty || price)) hints.push('ذخیره را انتخاب کنید');
        if (p && ppu == null) hints.push('تبدیلِ «' + unit + '» به واحدِ ذخیره ممکن نیست — ثقل را وارد کنید');
        if (/تن|کیلو/.test(unit) && !(g > 0)) hints.push('برای واحدِ وزنی، ثقل لازم است');
        var qP = (p && ppu != null) ? R(qty * ppu, 6) : 0;
        if (!isP && p && qP > N(p.stock) + 1e-9 && qty > 0) hints.push('مقدار از موجودیِ ذخیره (' + fmt(p.stock) + ' ' + (p.unit || '') + ') بیشتر است');
        if (isP && p && N(p.capacity) > 0 && N(p.stock) + qP > N(p.capacity) + 1e-9) hints.push('پس از این خرید، موجودی از ظرفیتِ ذخیره (' + fmt(p.capacity) + ') بیشتر می‌شود');
        if (hint) hint.textContent = hints.join(' • ');
        // فیلدهای پنهان (واحدِ اصلیِ ذخیره)
        var hq = hidQty(row, isP), hp = hidPrice(row, isP);
        if (hq) hq.value = qP > 0 ? qP : 0;
        if (hp) hp.value = (qP > 0) ? (total / qP) : (ppu ? price / (ppu || 1) : '');
        var te = totalEl(row, isP);
        if (te) { te.dataset.raw = total; te.textContent = total ? fmt(total, 2) : ''; }
        var le = row.querySelector('.ps-liters'); if (le) le.textContent = (liters != null && qty) ? fmt(liters, 3) : '';
        row.dataset.psLiters = (liters != null) ? liters : '';
        row.dataset.unitType = 'primary'; row.dataset.secondaryFactor = '';
        if (isP) calculatePurchaseTotal(); else calculateSalesTotal();
        applyDigits();
    }
    PS.recalcRow = recalcRow;

    // ── هوکِ saveSale/savePurchase: اطلاعاتِ پمپ روی خودِ قلمِ بل ──
    window._psItemExtras = function (row, kind) {
        if (!row || !row.classList.contains('ps-row')) return {};
        var isP = (kind === 'purchase');
        var p = getProduct((hidProd(row, isP) || {}).value);
        var meterSel = row.querySelector('.ps-meter');
        var m = meterSel ? getMeter(meterSel.value) : null;
        var unit = (row.querySelector('.ps-unit') || {}).value || (p && p.unit) || '';
        var g = N((row.querySelector('.ps-gravity') || {}).value) || (p ? tankGravity(p) : 0);
        var te = totalEl(row, isP);
        var out = {
            fuelType: (row.querySelector('.ps-fuel') || {}).value || tankFuel(p),
            tankId: p ? p.id : null, tankName: p ? p.name : '',
            gravity: g,
            enteredQty: N((row.querySelector('.ps-qty') || {}).value),
            enteredUnit: unit,
            enteredPrice: N((row.querySelector('.ps-price') || {}).value),
            liters: N(row.dataset.psLiters) || 0,
            unitType: 'primary', secondaryFactor: 0
        };
        if (te && te.dataset.raw !== undefined) out.total = N(te.dataset.raw);
        if (m) { out.meterId = m.id; out.meterName = m.name; out.meterNumber = m.number; }
        else if (!isP) { out.meterId = null; out.meterName = ''; out.meterNumber = ''; }
        return out;
    };

    // ── قیمت هنگامِ تعویضِ ارزِ بل ──
    var _origUpdateItemPrice = window.updateItemPrice, _origUpdatePurchaseItemPrice = window.updatePurchaseItemPrice;
    window.updateItemPrice = function (el) {
        var row = el && el.closest && el.closest('.item-row');
        if (row && row.classList.contains('ps-row')) {
            if (window._billHydrating) { recalcRow(row); return; }
            if (!row.dataset.psManualPrice) suggestPrice(row);
            recalcRow(row); return;
        }
        return _origUpdateItemPrice.apply(this, arguments);
    };
    window.updatePurchaseItemPrice = function (el) {
        var row = el && el.closest && el.closest('.purchase-item-row');
        if (row && row.classList.contains('ps-row')) {
            if (window._billHydrating) { recalcRow(row); return; }
            if (!row.dataset.psManualPrice) suggestPrice(row);
            recalcRow(row); return;
        }
        return _origUpdatePurchaseItemPrice.apply(this, arguments);
    };
    // نسخه‌های هسته که مستقیماً روی سطر کار می‌کنند — برای سطرهای پمپ به recalcRow هدایت شوند
    var _origUpdateItemTotal = window.updateItemTotal, _origUpdatePurchaseItemTotal = window.updatePurchaseItemTotal;
    window.updateItemTotal = function (input) {
        var row = input && input.closest && input.closest('.item-row');
        if (row && row.classList.contains('ps-row') && !window._billHydrating) {
            // ویرایشِ بل: هسته مقدار/قیمتِ «واحدِ اصلی» را مستقیم پر می‌کند → فقط جمع‌ها
            var te = totalEl(row, false), q = N(hidQty(row, false).value), pr = N(hidPrice(row, false).value);
            if (te && !N(te.dataset.raw) && q && pr) { te.dataset.raw = q * pr; te.textContent = fmt(q * pr, 2); }
            calculateSalesTotal(); return;
        }
        if (row && row.classList.contains('ps-row')) { calculateSalesTotal(); return; }
        return _origUpdateItemTotal.apply(this, arguments);
    };
    window.updatePurchaseItemTotal = function (input) {
        var row = input && input.closest && input.closest('.purchase-item-row');
        if (row && row.classList.contains('ps-row')) {
            var te = totalEl(row, true), q = N(hidQty(row, true).value), pr = N(hidPrice(row, true).value);
            if (te && !N(te.dataset.raw) && q && pr) { te.dataset.raw = q * pr; te.textContent = fmt(q * pr, 2); }
            calculatePurchaseTotal(); return;
        }
        return _origUpdatePurchaseItemTotal.apply(this, arguments);
    };

    // ── انتخاب از لیستِ ذخایر (دکمهٔ «ذخایر» در نوارِ بل) ──
    window._insertSalesProductRow = function (prod) {
        var row = firstEmptyRow(false) || addRow(false);
        setRowTank(row, prod && prod.id, {});
        focusQty(row);
    };
    window._insertPurchaseProductRow = function (prod) {
        var row = firstEmptyRow(true) || addRow(true);
        setRowTank(row, prod && prod.id, {});
        focusQty(row);
    };
    function openTankPicker(isP) {
        var row = firstEmptyRow(isP) || addRow(isP);
        var inp = row.querySelector('.product-search-input');
        try { showAllProductsForField(inp, !!isP); } catch (e) { console.warn(e); }
    }
    window.pickProductFromGrandTotal = function () { openTankPicker(false); };
    window.pickPurchaseProductFromList = function () { openTankPicker(true); };
    // پس از بازگشت از انتخابگر بدونِ انتخاب، سطرهای خالیِ اضافی جمع شوند
    window._normalizeItemRows = function (isP) {
        var rows = Array.prototype.slice.call(document.querySelectorAll('#' + (isP ? 'purchase' : 'sales') + '-items-body ' + rowSel(isP)));
        var empties = rows.filter(function (r) { var h = hidProd(r, isP); var f = r.querySelector('.ps-fuel'); return (!h || !h.value) && !(f && f.value); });
        if (rows.length > 1) empties.slice(rows.length === empties.length ? 1 : 0).forEach(function (r) { r.remove(); });
        if (!document.querySelector('#' + (isP ? 'purchase' : 'sales') + '-items-body ' + rowSel(isP))) addRow(isP);
        renumber(isP);
    };

    // ── ریست/آغازِ فورم‌ها: سطرِ نخستِ کارتی ──
    function resetRows(isP) {
        var tb = bodyOf(isP); if (!tb) return;
        tb.innerHTML = '';
        addRow(isP);
    }
    wrap('resetSalesForm', function () {
        resetRows(false);
        var ti = $('sales-transport-input'); if (ti) ti.value = 0;
        var tt = $('sales-total-transport'); if (tt) tt.textContent = fmt(0);
        var tb = $('sales-transport-btn'); if (tb) tb.classList.remove('bill-pill-active');
        var cb = $('add-to-delivery-checkbox'); if (cb) cb.checked = false;
        var db1 = $('sales-delivery-btn'); if (db1) db1.classList.remove('bill-pill-active');
        try { calculateSalesTotal(); } catch (e) {}
    });
    wrap('resetPurchaseForm', function () { resetRows(true); try { calculatePurchaseTotal(); } catch (e) {} });

    // ── بازکردنِ بل برای ویرایش: پرکردنِ فیلدهای پمپ از خودِ سند ──
    function hydrate(tx) {
        if (!tx || !Array.isArray(tx.items)) return;
        var isP = tx.type === 'خرید';
        var rows = Array.prototype.slice.call(document.querySelectorAll('#' + (isP ? 'purchase' : 'sales') + '-items-body ' + rowSel(isP)));
        var items = tx.items.filter(function (it) { return it && !it.isWastage; });
        window._billHydrating = true;
        try {
            items.forEach(function (it, i) {
                var row = rows[i]; if (!row || !row.classList.contains('ps-row')) return;
                var p = getProduct(it.productId);
                setRowTank(row, it.productId, { keepPrice: true, keepQty: true });
                var f = row.querySelector('.ps-fuel'); if (f && it.fuelType) { if (!Array.prototype.some.call(f.options, function (o) { return o.value === it.fuelType; })) { var o = document.createElement('option'); o.value = o.textContent = it.fuelType; f.appendChild(o); } f.value = it.fuelType; }
                var unit = it.enteredUnit || it.unit || (p && p.unit) || 'لیتر';
                var us = row.querySelector('.ps-unit');
                if (us) { if (!Array.prototype.some.call(us.options, function (o) { return o.value === unit; })) { var o2 = document.createElement('option'); o2.value = o2.textContent = unit; us.appendChild(o2); } us.value = unit; }
                var g = row.querySelector('.ps-gravity'); if (g) { g.value = N(it.gravity) || (p ? tankGravity(p) : '') || ''; row.dataset.psGravityManual = '1'; }
                var q = row.querySelector('.ps-qty'); if (q) q.value = (it.enteredQty != null && N(it.enteredQty) > 0) ? it.enteredQty : N(it.quantity);
                var pr = row.querySelector('.ps-price');
                var tot = (it.total != null && N(it.total)) ? N(it.total) : N(it.quantity) * N(it.price);
                if (pr) pr.value = (it.enteredPrice != null && N(it.enteredPrice) > 0) ? it.enteredPrice : (N(q && q.value) ? R(tot / N(q.value), 6) : N(it.price));
                row.dataset.psManualPrice = '1';
                if (!isP) { fillRowMeters(row); var ms = row.querySelector('.ps-meter'); if (ms) ms.value = it.meterId ? String(it.meterId) : ''; }
                recalcRow(row);
            });
        } finally { window._billHydrating = false; }
        if (isP) { calculatePurchaseTotal(); try { calculatePurchaseRemaining(); } catch (e) {} }
        else {
            // مصرف انتقالِ ذخیره‌شدهٔ همین بل
            var ex = saleTransportExpense(tx.id);
            var ti = $('sales-transport-input'); if (ti) ti.value = ex ? N(ex.amount) : 0;
            psSaleTransportChanged();
            calculateSalesTotal(); try { calculateRemaining(); } catch (e) {}
        }
    }
    PS.hydrate = hydrate;
    var _origEditTx = window.editTransaction;
    window.editTransaction = function (id) {
        var r = _origEditTx.apply(this, arguments);
        var tx = transactions().find(function (t) { return String(t.id) === String(id); });
        if (tx && (tx.type === 'فروش' || tx.type === 'خرید' || tx.type === 'پیش‌فاکتور')) {
            var tries = 0;
            var tick = function () {
                tries++;
                var form = $(tx.type === 'خرید' ? 'purchaseForm' : 'salesForm');
                if (form && String(form.dataset.editId || '') === String(id)) { hydrate(tx); return; }
                if (tries < 40) setTimeout(tick, 50);
            };
            setTimeout(tick, 220);
        }
        return r;
    };

    // =============================================================================
    //  «مصرف انتقال» در بل فروش — یک مصرفِ واقعی (از حسابِ انتخاب‌شده) که به همین بل
    //  بسته است. در ویرایش/حذفِ بل، اثرِ قبلی برگردانده و دوباره ثبت می‌شود.
    //  (در بل خرید، «مصرف انتقال» همان هزینه حمل و نقلِ موجود است که در بهای تمام‌شده
    //   تقسیم می‌شود — منطقِ برنامهٔ اصلی بدونِ تغییر.)
    // =============================================================================
    function saleTransportExpense(saleId) {
        var ex = []; try { ex = db.getExpenses() || []; } catch (e) {}
        return ex.find(function (e) { return e && e.isSaleTransport && String(e.relatedSaleId) === String(saleId); }) || null;
    }
    function removeSaleTransport(saleId) {
        try {
            var ex = db.getExpenses() || [];
            var mine = ex.filter(function (e) { return e && e.isSaleTransport && String(e.relatedSaleId) === String(saleId); });
            if (mine.length) {
                mine.forEach(function (e) { if (e.cashboxId && N(e.amount) > 0) db.updateCashboxBalance(e.cashboxId, N(e.amount), 'in', e.currency || baseCur()); });
                localStorage.setItem('expenses', JSON.stringify(ex.filter(function (e) { return mine.indexOf(e) === -1; })));
            }
            var logs = lsGet('cashboxTransactions', []);
            if (Array.isArray(logs)) {
                var keep = logs.filter(function (t) { return !(t && t.isSaleTransport && String(t.relatedSaleId) === String(saleId)); });
                if (keep.length !== logs.length) lsSet('cashboxTransactions', keep);
            }
        } catch (e) { console.warn('removeSaleTransport:', e); }
    }
    function syncSaleTransport(tx, amount) {
        if (!tx || tx.id == null) return;
        removeSaleTransport(tx.id);
        amount = N(amount);
        if (!(amount > 0)) return;
        var cb = tx.cashboxId || ($('sales-cashbox') || {}).value || '';
        if (!cb) { try { var d = getDefaultCashboxIdForCurrency(tx.currency || baseCur()); if (d) cb = d; } catch (e) {} }
        var boxes = []; try { boxes = db.getCashboxes() || []; } catch (e) {}
        var box = boxes.find(function (b) { return String(b.id) === String(cb); });
        var exp = {
            title: 'مصرف انتقال — بل ' + (tx.billNumber || ''), category: 'مصرف انتقال', amount: amount,
            currency: tx.currency || baseCur(), date: tx.date || nowDT(),
            cashboxId: cb ? parseInt(cb, 10) : null, cashboxName: box ? box.name : '',
            personId: null, notes: 'مصرف انتقالِ تیل به ' + (tx.customerName || 'خریدار'), type: 'مصرف',
            isSaleTransport: true, relatedSaleId: tx.id
        };
        var r = db.saveExpense(exp);
        if (r && r.success && cb) {
            try { _logCashboxTransaction(parseInt(cb, 10), { type: 'expense', amount: amount, currency: exp.currency, datetime: exp.date, notes: exp.notes, description: 'مصرف: ' + exp.title + ' (مصرف انتقال)', isSaleTransport: true, relatedSaleId: tx.id }); } catch (e) {}
        }
    }
    function psSaleTransportChanged() {
        var v = N(($('sales-transport-input') || {}).value);
        var t = $('sales-total-transport'); if (t) t.textContent = fmt(v, 2);
        var b = $('sales-transport-btn'); if (b) b.classList.toggle('bill-pill-active', v > 0);
    }
    window.psSaleTransportChanged = psSaleTransportChanged;
    window.psToggleSaleTransport = function () {
        var panel = $('sales-transport-panel'); if (!panel) return;
        var other = $('sales-discount-panel'); if (other) other.classList.remove('open');
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) { var i = $('sales-transport-input'); if (i) setTimeout(function () { i.focus(); try { i.select(); } catch (e) {} }, 20); }
    };
    // بستنِ پنل با کلیک بیرون
    document.addEventListener('click', function (e) {
        var panel = $('sales-transport-panel');
        if (panel && panel.classList.contains('open') && !e.target.closest('#sales-transport-panel') && !e.target.closest('#sales-transport-btn')) panel.classList.remove('open');
        var ap = $('ps-addpay-pop');
        if (ap && !e.target.closest('#ps-addpay-pop') && !e.target.closest('.bill-inline-iconbtn')) ap.remove();
    });
    var _origSaveSale = window.saveSale;
    window.saveSale = function () {
        var form = $('salesForm');
        var editId = form && form.dataset.editId;
        var amount = N(($('sales-transport-input') || {}).value);
        var before = {};
        transactions().forEach(function (t) { before[String(t.id)] = 1; });
        var r = _origSaveSale.apply(this, arguments);
        try {
            var tx = null;
            if (editId) {
                // ویرایش فقط وقتی موفق بوده که فرم از حالتِ ویرایش خارج شده باشد
                if (!(form && form.dataset.editId)) tx = transactions().find(function (t) { return String(t.id) === String(editId); });
            } else {
                var fresh = transactions().filter(function (t) { return t && t.type === 'فروش' && !before[String(t.id)]; });
                tx = fresh.length ? fresh[fresh.length - 1] : null;
            }
            if (tx) {
                if (amount > 0 || saleTransportExpense(tx.id)) syncSaleTransport(tx, amount);
                // میترهایی که در این بل استفاده شده‌اند: زنجیرهٔ قرائت‌ها تازه شود
                var ms = {}; (tx.items || []).forEach(function (it) { if (it && it.meterId) ms[it.meterId] = 1; });
                Object.keys(ms).forEach(function (mid) { try { rechain(mid); } catch (e) {} });
            }
        } catch (e) { console.warn('pump saveSale post:', e); }
        return r;
    };
    // حذفِ بل → مصرفِ انتقالِ وابسته هم برگردد/حذف شود؛ قرائت‌ها بازمحاسبه شوند
    var _origDeleteTx = window.deleteTransaction;
    window.deleteTransaction = function (id) {
        var origConfirm = window.showConfirm;
        var restored = false;
        window.showConfirm = function (title, text, cb) {
            window.showConfirm = origConfirm; restored = true;
            return origConfirm.call(this, title, text, function () {
                var tx = transactions().find(function (t) { return String(t.id) === String(id); });
                var res = cb.apply(this, arguments);
                try {
                    var still = transactions().some(function (t) { return String(t.id) === String(id); });
                    if (!still) {
                        removeSaleTransport(id);
                        var ms = {}; ((tx && tx.items) || []).forEach(function (it) { if (it && it.meterId) ms[it.meterId] = 1; });
                        Object.keys(ms).forEach(function (mid) { try { rechain(mid); } catch (e) {} });
                        // اگر این بل، فروشِ نقدیِ یک قرائت بود، پیوندش پاک شود
                        var rs = getReadings(), ch = false;
                        rs.forEach(function (r) { if (r && String(r.autoSaleId) === String(id)) { r.autoSaleId = null; r.autoSaleBill = ''; ch = true; } });
                        if (ch) saveReadingsList(rs);
                    }
                } catch (e) { console.warn('pump delete post:', e); }
                return res;
            });
        };
        try { return _origDeleteTx.apply(this, arguments); }
        finally { if (!restored && window.showConfirm !== origConfirm) window.showConfirm = origConfirm; }
    };

    // =============================================================================
    //  ⊕ افزودنِ مبلغ به دریافتی/پرداختی (پرداخت‌های چندمرحله‌ای)
    // =============================================================================
    window.psAddPayment = function (isP, btn) {
        var old = $('ps-addpay-pop'); if (old) { old.remove(); return; }
        var pop = document.createElement('div');
        pop.id = 'ps-addpay-pop';
        pop.className = 'ps-addpay-pop';
        pop.innerHTML = '<div class="ps-addpay-title">' + (isP ? 'افزودن به پرداختی' : 'افزودن به دریافتی') + '</div>' +
            '<input type="number" id="ps-addpay-amount" step="any" min="0" placeholder="مبلغ">' +
            '<div class="ps-addpay-actions"><button type="button" class="bill-btn-save" id="ps-addpay-ok"><i class="fas fa-plus"></i> افزودن</button>' +
            '<button type="button" class="bill-btn-cancel" id="ps-addpay-cancel">لغو</button></div>';
        document.body.appendChild(pop);
        var r = btn.getBoundingClientRect();
        var st = window.pageYOffset || document.documentElement.scrollTop, sl = window.pageXOffset || document.documentElement.scrollLeft;
        pop.style.top = (r.bottom + st + 6) + 'px';
        pop.style.left = Math.max(8, Math.min(r.left + sl - 80, sl + document.documentElement.clientWidth - 240)) + 'px';
        var inp = $('ps-addpay-amount'); setTimeout(function () { inp.focus(); }, 20);
        var apply = function () {
            var add = N(inp.value);
            if (!(add > 0)) { pop.remove(); return; }
            var cur = billCurrency(isP), base = baseCur();
            var chk = $(isP ? 'purchase-full-payment-checkbox' : 'full-payment-checkbox');
            var icon = $(isP ? 'purchase-fullpay-icon' : 'sales-fullpay-icon');
            var fid = (cur === base) ? (isP ? 'purchase-paid-afn' : 'sales-cash-afn') : (isP ? 'purchase-paid-foreign' : 'sales-cash-foreign');
            var f = $(fid);
            if (chk && chk.checked) {
                chk.checked = false; if (icon) icon.classList.remove('is-active');
                ['sales-cash-afn', 'sales-cash-usd', 'sales-cash-foreign', 'purchase-paid-afn', 'purchase-paid-usd', 'purchase-paid-foreign'].forEach(function (i) { var e = $(i); if (e && e.id.indexOf(isP ? 'purchase' : 'sales') === 0) e.disabled = false; });
            }
            if (f) { f.disabled = false; f.value = R(N(f.value) + add, 4); }
            try { if (isP) calculatePurchaseRemaining(); else calculateRemaining(); } catch (e) {}
            pop.remove();
            toast('مبلغ ' + fmt(add, 2) + ' اضافه شد');
        };
        $('ps-addpay-ok').onclick = apply;
        $('ps-addpay-cancel').onclick = function () { pop.remove(); };
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } if (e.key === 'Escape') pop.remove(); });
        applyDigits();
    };

    // =============================================================================
    //  نمایش/چاپ: «اطلاعات فروش/خرید»، بل چاپی، لیست معاملاتِ شخص
    // =============================================================================
    function itemFuelLine(it) {
        if (!it || it.isService) return '';
        var parts = [];
        var p = getProduct(it.productId);
        var fuel = it.fuelType || tankFuel(p);
        if (fuel) parts.push(fuel);
        if (N(it.gravity)) parts.push('ثقل ' + fmt(it.gravity, 4));
        var L = N(it.liters);
        if (!L && p) { var Lp = unitLiters(p.unit, N(it.gravity) || tankGravity(p)); if (Lp != null) L = N(it.quantity) * Lp; }
        if (L) parts.push(fmt(L, 2) + ' لیتر');
        if (it.meterName) parts.push('میتر: ' + it.meterName + (it.meterNumber ? ' (' + it.meterNumber + ')' : ''));
        return parts.join(' • ');
    }
    window._psInvoiceDesc = function (item, desc) {
        var line = itemFuelLine(item);
        if (!line) return desc;
        var entered = '';
        if (item.enteredUnit && item.enteredUnit !== item.unit && N(item.enteredQty)) entered = fmt(item.enteredQty, 3) + ' ' + item.enteredUnit + ' × ' + fmt(item.enteredPrice, 2) + ' — ';
        return (desc ? desc + ' — ' : '') + entered + line;
    };
    window._psTxFuelSummary = function (tx) {
        if (!tx || !Array.isArray(tx.items) || (tx.type !== 'فروش' && tx.type !== 'خرید' && tx.type !== 'برگشت')) return '';
        var byFuel = {};
        tx.items.forEach(function (it) {
            if (!it || it.isService) return;
            var p = getProduct(it.productId);
            var f = it.fuelType || tankFuel(p) || (it.productName || '');
            var L = N(it.liters);
            if (!L) { var Lp = p ? unitLiters(p.unit, N(it.gravity) || tankGravity(p)) : 1; L = N(it.quantity) * (Lp == null ? 1 : Lp); }
            byFuel[f] = (byFuel[f] || 0) + L;
        });
        return Object.keys(byFuel).map(function (f) { return f + ' ' + fmt(byFuel[f], 2) + ' لیتر'; }).join('، ');
    };
    wrap('showTxDetail', function (r, id) {
        var tx = transactions().find(function (t) { return String(t.id) === String(id); });
        if (!tx || !Array.isArray(tx.items) || (tx.type !== 'فروش' && tx.type !== 'خرید')) return;
        var tb = $('txd-items'); if (!tb || !tx.items.length) return;
        var cur = tx.currency || baseCur();
        tb.innerHTML = tx.items.map(function (it, i) {
            var p = getProduct(it.productId);
            var fuel = it.fuelType || tankFuel(p) || '';
            var name = esc(fuel ? fuel + ' — ' : '') + esc(it.tankName || it.productName || (p && p.name) || '—') +
                (it.meterName ? '<br><small class="ps-muted"><i class="fas fa-gauge-high"></i> ' + esc(it.meterName) + (it.meterNumber ? ' (' + esc(it.meterNumber) + ')' : '') + '</small>' : '');
            var q = (it.enteredQty != null && N(it.enteredQty)) ? N(it.enteredQty) : N(it.quantity);
            var unit = it.enteredUnit || it.unit || '';
            var tot = (it.total != null && N(it.total)) ? N(it.total) : N(it.quantity) * N(it.price) - N(it.discount);
            var price = (it.enteredPrice != null && N(it.enteredPrice)) ? N(it.enteredPrice) : (q ? (tot + N(it.discount)) / q : N(it.price));
            var line = itemFuelLine(it);
            var lit = N(it.liters);
            return '<tr><td>' + fmt(i + 1, 0) + '</td><td style="text-align:right;">' + name + '</td><td>' + fmt(q, 3) + '</td><td>' + esc(unit) +
                (lit && unit !== 'لیتر' ? '<br><small class="ps-muted">' + fmt(lit, 2) + ' لیتر</small>' : '') + (N(it.gravity) ? '<br><small class="ps-muted">ثقل ' + fmt(it.gravity, 4) + '</small>' : '') +
                '</td><td>' + fmt(price, 4) + '</td><td>' + fmt(it.discount) + '</td><td>' + fmt(tot, 2) + '</td></tr>';
        }).join('');
        // مصرف انتقالِ این بل
        if (tx.type === 'فروش') {
            var ex = saleTransportExpense(tx.id);
            var rows = $('txd-rows-summary');
            if (ex && rows && !rows.querySelector('.ps-transport-row')) {
                var d = document.createElement('div');
                d.className = 'pdc-row ps-transport-row';
                d.innerHTML = '<span class="pdc-row-label">مصرف انتقال</span><span class="pdc-row-value">' + fmt(ex.amount, 2) + ' ' + esc(curLabel(ex.currency || cur)) + '</span>';
                rows.appendChild(d);
            }
        }
        applyDigits();
    });

    // ── لیست‌های سریعِ فروش/خرید: خلاصهٔ نوع تیل و لیتر روی هر کارت ──
    function decorateTxList(tbodyId, iconCls) {
        var tb = $(tbodyId); if (!tb) return;
        var all = transactions();
        tb.querySelectorAll('tr').forEach(function (tr) {
            var k = tr.querySelector('.sales-card-kebab'); if (!k) return;
            var m = String(k.getAttribute('onmouseenter') || k.getAttribute('onclick') || '').match(/ActionBar\(event,\s*(\d+)/);
            if (!m) return;
            var tx = all.find(function (t) { return String(t.id) === m[1]; }); if (!tx) return;
            var ic = tr.querySelector('.sales-card-icon i'); if (ic && iconCls) ic.className = 'fas ' + iconCls;
            var meta = tr.querySelector('.sales-card-meta');
            var sum = window._psTxFuelSummary(tx);
            if (meta && sum && !meta.querySelector('.ps-fuel-meta')) {
                var sp = document.createElement('span');
                sp.className = 'sales-card-meta-item ps-fuel-meta';
                sp.innerHTML = '<b class="sales-meta-label">تیل:</b><span class="sales-meta-val">' + esc(sum) + '</span>';
                meta.appendChild(sp);
            }
        });
        applyDigits();
    }
    wrap('loadSalesList', function () { decorateTxList('sales-list-tbody', 'fa-gas-pump'); });
    wrap('loadPurchasesList', function () { decorateTxList('purchases-list-tbody', 'fa-truck-droplet'); });

    // =============================================================================
    //  داشبورد: «موجودی ذخایر» + کارتِ «قید/قرائت میتر»
    // =============================================================================
    function stockByFuel() {
        var m = {};
        products().forEach(function (p) {
            var f = tankFuel(p) || 'نامشخص';
            var L = stockLiters(p);
            if (!m[f]) m[f] = { liters: 0, cap: 0, other: [] };
            if (L != null) { m[f].liters += L; var capL = stockLiters(p, p.capacity); if (capL) m[f].cap += capL; }
            else m[f].other.push(fmt(p.stock) + ' ' + (p.unit || ''));
        });
        return m;
    }
    PS.stockByFuel = stockByFuel;
    wrap('ndRenderFinancial', function () {
        var el = $('nd-fin-stock'); if (!el) return;
        var m = stockByFuel();
        var keys = Object.keys(m);
        if (!keys.length) { el.innerHTML = '<span class="nd-money nd-money-zero"><b>0</b><i>لیتر</i></span>'; return; }
        el.innerHTML = keys.map(function (f) {
            var x = m[f];
            var s = '<span class="nd-money ps-stock-chip" style="--ps-fuel:' + fuelColor(f) + '" title="' + esc(f) + (x.cap ? ' — ظرفیت: ' + fmt(x.cap, 0) + ' لیتر' : '') + '"><b>' + fmt(x.liters, 0) + '</b><i>لیتر ' + esc(f) + '</i></span>';
            x.other.forEach(function (o) { s += '<span class="nd-money"><b>' + esc(o) + '</b><i>' + esc(f) + '</i></span>'; });
            return s;
        }).join('');
        applyDigits();
    });
    function renderDashMeters() {
        var tb = $('nd-meters-body'); if (!tb) return;
        var rs = getReadings().slice().sort(function (a, b) { return N(b.at) - N(a.at); }).slice(0, 8);
        if (!rs.length) {
            tb.innerHTML = '<tr><td colspan="5" class="nd-empty">' + (getMeters().length ? 'هنوز قرائتی ثبت نشده است.' : 'میتری تعریف نشده است — از بخش ذخایر ← تب میتر تعریف کنید.') + '</td></tr>';
        } else {
            tb.innerHTML = rs.map(function (r) {
                var dcls = N(r.diffLiters) > 0.0005 ? 'ps-diff-pos' : (N(r.diffLiters) < -0.0005 ? 'ps-diff-neg' : '');
                return '<tr class="nd-meter-tr" onclick="showMeterReadingForm(' + r.meterId + ',' + r.id + ')" title="' + esc((r.meterName || '') + (Math.abs(N(r.diffLiters)) > 0.0005 ? ' — تفاوت: ' + fmt(r.diffLiters) + ' لیتر' : '')) + '">' +
                    '<td>' + esc(String(r.date || '').split(' ')[0]) + '</td><td>' + esc(r.meterNumber || r.meterName || '') + '</td>' +
                    '<td>' + fmt(r.prevReading) + '</td><td>' + fmt(r.currentReading) + '</td><td class="' + dcls + '">' + fmt(r.dispensed) + '</td></tr>';
            }).join('');
        }
        var sum = $('nd-meters-summary');
        if (sum) {
            var d = today();
            var todays = getReadings().filter(function (r) { return String(r.date || '').split(' ')[0] === d; });
            var disp = todays.reduce(function (s, r) { return s + N(r.dispensed); }, 0);
            var diff = todays.reduce(function (s, r) { return s + N(r.diffLiters); }, 0);
            var pending = getMeters().filter(function (m) { return !todays.some(function (r) { return String(r.meterId) === String(m.id); }); }).length;
            sum.innerHTML = getMeters().length ? (
                '<span class="ps-sum-chip"><span>مصرفِ امروز</span><b>' + fmt(disp) + ' لیتر</b></span>' +
                '<span class="ps-sum-chip ' + (diff > 0.0005 ? 'ps-diff-pos' : (diff < -0.0005 ? 'ps-diff-neg' : '')) + '"><span>تفاوتِ امروز</span><b>' + fmt(diff) + ' لیتر</b></span>' +
                '<span class="ps-sum-chip' + (pending ? ' ps-warn-chip' : '') + '"><span>میترهای بدونِ قرائتِ امروز</span><b>' + fmt(pending, 0) + '</b></span>') : '';
        }
        applyDigits();
    }
    PS.renderDashMeters = renderDashMeters;
    window.psToggleDashMeters = function () {
        var c = $('nd-meters-card'); if (!c) return;
        c.classList.toggle('collapsed');
        try { localStorage.setItem('apexps_dash_meters_collapsed', c.classList.contains('collapsed') ? '1' : '0'); } catch (e) {}
    };
    wrap('ndRenderBrand', function () {
        try { document.querySelectorAll('#dashboard-store-info-panel .dsi-default-icon.fa-store').forEach(function (i) { i.classList.remove('fa-store'); i.classList.add('fa-gas-pump'); }); } catch (e) {}
    });
    wrap('ndRenderDashboard', function () {
        try { var c = $('nd-meters-card'); if (c && localStorage.getItem('apexps_dash_meters_collapsed') === '1') c.classList.add('collapsed'); } catch (e) {}
        renderDashMeters();
        try { ndFitDashboardHeight(); } catch (e) {}
    });

    // =============================================================================
    //  مشخصاتِ ذخیره (صفحهٔ «مشخصات ذخیره»)
    // =============================================================================
    wrap('showProductDetail', function (r, productId) {
        var p = getProduct(productId); if (!p) return;
        var el = $('pdc-rows-specs'); if (!el) return;
        // ردیف‌های بی‌ربط به پمپ استیشن حذف شوند
        Array.prototype.slice.call(el.querySelectorAll('.pdc-row')).forEach(function (row) {
            var l = (row.querySelector('.pdc-row-label') || {}).textContent || '';
            if (/تاریخ انقضاء|مالیات بر ارزش|جزئیات در بل/.test(l) || l.trim() === 'کتگوری' || l.trim() === 'کتگوری فرعی') row.remove();
            else if (l.trim() === 'کد') { var lb = row.querySelector('.pdc-row-label'); if (lb) lb.textContent = 'نمبر ذخیره'; }
        });
        var row = function (label, value, cls) { return '<div class="pdc-row"><span class="pdc-row-label">' + label + '</span><span class="pdc-row-value' + (cls ? ' ' + cls : '') + '">' + value + '</span></div>'; };
        var L = stockLiters(p), fill = tankFill(p), g = tankGravity(p);
        var meters = getMeters().filter(function (m) { return String(m.tankId) === String(p.id); });
        var h = row('نوع تیل', '<span class="ps-fuel-dot" style="--ps-fuel:' + fuelColor(tankFuel(p)) + '"></span> ' + esc(tankFuel(p) || '—')) +
            row('ثقل', g ? fmt(g, 4) : '—') +
            row('ظرفیت کل', N(p.capacity) ? fmt(p.capacity) + ' ' + esc(p.unit || '') + (stockLiters(p, p.capacity) != null && p.unit !== 'لیتر' ? ' (' + fmt(stockLiters(p, p.capacity)) + ' لیتر)' : '') : '—') +
            (L != null ? row('موجودی به لیتر', fmt(L, 3) + ' لیتر', 'pdc-v-blue') : '') +
            (L != null && g ? row('وزنِ موجودی', fmt(L * g / 1000, 4) + ' تن') : '') +
            (fill != null ? row('فیصدی پُری', '<span class="ps-fill ps-fill-sm" style="--ps-fuel:' + fuelColor(tankFuel(p)) + '"><span class="ps-fill-bar" style="width:' + Math.max(0, Math.min(100, fill)) + '%"></span><span>' + fmt(fill, 1) + '٪</span></span>') : '') +
            (N(p.capacity) ? row('ظرفیتِ خالی', fmt(Math.max(0, N(p.capacity) - N(p.stock))) + ' ' + esc(p.unit || '')) : '') +
            row('میترهای وصل‌شده', meters.length ? meters.map(function (m) { return esc(m.name) + ' (' + esc(m.number) + ')'; }).join('، ') : '—');
        el.insertAdjacentHTML('afterbegin', h);
        applyDigits();
    });

    // ── فورم‌های برگشت: نمایشِ نوع تیل/لیتر کنارِ نامِ ذخیره ──
    function decorateReturnRow(tr) {
        if (!tr || tr.querySelector('.ps-ret-hint')) return;
        var p = getProduct(tr.dataset.productId);
        if (!p) return;
        var cell = tr.cells && tr.cells[1]; if (!cell) return;
        var hint = document.createElement('small');
        hint.className = 'ps-ret-hint';
        var upd = function () {
            var q = N((tr.querySelector('.sr-qty, .pr-qty') || {}).value);
            var L = stockLiters(p, q);
            hint.innerHTML = '<span class="ps-fuel-dot" style="--ps-fuel:' + fuelColor(tankFuel(p)) + '"></span> ' + esc(tankFuel(p)) + (L != null && p.unit !== 'لیتر' && q ? ' • ' + fmt(L, 2) + ' لیتر' : '');
        };
        upd();
        cell.appendChild(hint);
        var qi = tr.querySelector('.sr-qty, .pr-qty'); if (qi) qi.addEventListener('input', upd);
    }
    wrap('srAddReturnRow', function (tr) { decorateReturnRow(tr); });
    wrap('prAddReturnRow', function (tr) { decorateReturnRow(tr); });

    // =============================================================================
    //  گزارشِ «میترها و قرائت» + خلاصهٔ تیل (اکسل و PDF)
    // =============================================================================
    function inRange(ms, fromDate, toDate) {
        var f = fromDate ? dateMs(toEn(fromDate)) : 0;
        var t = toDate ? dateMs(toEn(toDate)) + 86399999 : 0;
        if (f && ms < f) return false;
        if (t && ms > t) return false;
        return true;
    }
    function meterReportData(fromDate, toDate) {
        var meters = getMeters().map(function (m) {
            var rs = readingsOf(m.id).filter(function (r) { return inRange(N(r.at), fromDate, toDate); });
            return {
                m: m, count: rs.length,
                disp: rs.reduce(function (s, r) { return s + N(r.dispensed); }, 0),
                billed: rs.reduce(function (s, r) { return s + N(r.billedLiters); }, 0),
                diff: rs.reduce(function (s, r) { return s + N(r.diffLiters); }, 0),
                value: rs.reduce(function (s, r) { return s + N(r.diffValue); }, 0)
            };
        });
        var fuels = {};
        fuelTypes().forEach(function (f) { fuels[f] = { purchased: 0, sold: 0, dispensed: 0, stock: 0, cap: 0 }; });
        transactions().forEach(function (tx) {
            if (!tx || !Array.isArray(tx.items) || (tx.type !== 'فروش' && tx.type !== 'خرید')) return;
            if (!inRange(dateMs(tx.date) || dateMs(tx.createdAt), fromDate, toDate)) return;
            tx.items.forEach(function (it) {
                if (!it || it.isService) return;
                var p = getProduct(it.productId);
                var f = it.fuelType || tankFuel(p) || 'نامشخص';
                var L = N(it.liters);
                if (!L) { var Lp = p ? unitLiters(p.unit, N(it.gravity) || tankGravity(p)) : 1; L = N(it.quantity) * (Lp == null ? 1 : Lp); }
                if (!fuels[f]) fuels[f] = { purchased: 0, sold: 0, dispensed: 0, stock: 0, cap: 0 };
                if (tx.type === 'خرید') fuels[f].purchased += L; else fuels[f].sold += L;
            });
        });
        meters.forEach(function (x) { var f = x.m.fuelType || 'نامشخص'; if (!fuels[f]) fuels[f] = { purchased: 0, sold: 0, dispensed: 0, stock: 0, cap: 0 }; fuels[f].dispensed += x.disp; });
        var sb = stockByFuel();
        Object.keys(sb).forEach(function (f) { if (!fuels[f]) fuels[f] = { purchased: 0, sold: 0, dispensed: 0, stock: 0, cap: 0 }; fuels[f].stock = sb[f].liters; fuels[f].cap = sb[f].cap; });
        return { meters: meters, fuels: fuels };
    }
    function meterReportAOA(d) {
        var aoa = [['خلاصهٔ تیل (لیتر)'], ['نوع تیل', 'خرید (لیتر)', 'فروش (لیتر)', 'مصرفِ میتر (لیتر)', 'موجودیِ فعلی (لیتر)', 'ظرفیت (لیتر)', 'فیصدی پُری']];
        Object.keys(d.fuels).forEach(function (f) { var x = d.fuels[f]; aoa.push([f, R(x.purchased, 3), R(x.sold, 3), R(x.dispensed, 3), R(x.stock, 3), R(x.cap, 3), x.cap ? R(x.stock / x.cap * 100, 1) + '٪' : '—']); });
        aoa.push([]);
        aoa.push(['میترها']);
        aoa.push(['نام میتر', 'نمبر میتر', 'نوع تیل', 'تعداد قرائت', 'مقدار مصرف (لیتر)', 'فروش ثبت‌شده (لیتر)', 'تفاوت (لیتر)', 'ارزش تفاوت']);
        d.meters.forEach(function (x) { aoa.push([x.m.name, x.m.number, x.m.fuelType, x.count, R(x.disp, 3), R(x.billed, 3), R(x.diff, 3), R(x.value, 2)]); });
        return aoa;
    }
    function meterReportCardHtml(d) {
        var h = '<div class="dash-card dash-card-collapsible pdc-card rp-persons-card ps-rp-card">';
        h += '<div class="dash-card-head" onclick="this.parentElement.classList.toggle(\'collapsed\')"><span class="dash-card-title"><i class="fas fa-gas-pump"></i> خلاصهٔ تیل و میترها</span>' +
            '<span class="ps-rp-actions"><button type="button" class="rp-dl-btn" onclick="event.stopPropagation();PumpStation.meterReportExcel()" title="اکسل"><i class="fas fa-file-excel"></i></button>' +
            '<button type="button" class="rp-dl-btn" onclick="event.stopPropagation();PumpStation.meterReportPdf()" title="PDF"><i class="fas fa-file-pdf"></i></button></span>' +
            '<i class="fas fa-chevron-down dash-card-chevron"></i></div><div class="dash-card-body">';
        h += '<div class="ps-rp-table-wrap"><table class="ps-rp-table"><thead><tr><th>نوع تیل</th><th>خرید</th><th>فروش</th><th>مصرف میتر</th><th>موجودی</th><th>پُری</th></tr></thead><tbody>';
        var fk = Object.keys(d.fuels);
        if (!fk.length) h += '<tr><td colspan="6">—</td></tr>';
        fk.forEach(function (f) {
            var x = d.fuels[f];
            h += '<tr><td><span class="ps-fuel-dot" style="--ps-fuel:' + fuelColor(f) + '"></span> ' + esc(f) + '</td><td>' + fmt(x.purchased) + '</td><td>' + fmt(x.sold) + '</td><td>' + fmt(x.dispensed) + '</td><td>' + fmt(x.stock) + '</td><td>' + (x.cap ? fmt(x.stock / x.cap * 100, 1) + '٪' : '—') + '</td></tr>';
        });
        h += '</tbody></table></div>';
        h += '<div class="ps-rp-table-wrap"><table class="ps-rp-table"><thead><tr><th>میتر</th><th>نوع تیل</th><th>قرائت‌ها</th><th>مصرف (لیتر)</th><th>فروش ثبت‌شده</th><th>تفاوت</th><th>ارزش تفاوت</th></tr></thead><tbody>';
        if (!d.meters.length) h += '<tr><td colspan="7">میتری تعریف نشده است.</td></tr>';
        d.meters.forEach(function (x) {
            var c = x.diff > 0.0005 ? 'ps-diff-pos' : (x.diff < -0.0005 ? 'ps-diff-neg' : '');
            h += '<tr class="ps-click" onclick="PumpStation.showReadingsList(' + x.m.id + ')"><td>' + esc(x.m.name) + ' <small class="ps-muted">(' + esc(x.m.number) + ')</small></td><td>' + esc(x.m.fuelType || '') + '</td><td>' + fmt(x.count, 0) + '</td><td>' + fmt(x.disp) + '</td><td>' + fmt(x.billed) + '</td><td class="' + c + '">' + fmt(x.diff) + '</td><td>' + fmt(x.value, 2) + '</td></tr>';
        });
        h += '</tbody></table></div></div></div>';
        return h;
    }
    function currentRange() { try { return getNewReportDateRange(); } catch (e) { return { fromDate: '', toDate: '' }; } }
    function showMeterReport() {
        var wrapEl = $('rp-persons-card-wrap'); var tableC = $('rp-results-container');
        if (tableC) tableC.style.display = 'none';
        if (!wrapEl) return;
        wrapEl.style.display = 'block'; wrapEl.classList.remove('rp-grid');
        var dr = currentRange();
        try { window._rpRerunLast = showMeterReport; } catch (e) {}
        wrapEl.innerHTML = meterReportCardHtml(meterReportData(dr.fromDate, dr.toDate));
        applyDigits();
    }
    PS.meterReportExcel = function () {
        try {
            if (typeof XLSX === 'undefined') { msg('خطا', 'کتابخانهٔ اکسل هنوز بارگذاری نشده است.'); return; }
            var dr = currentRange();
            var aoa = meterReportAOA(meterReportData(dr.fromDate, dr.toDate));
            aoa.unshift(['گزارش تیل و میترها — ' + ((dr.fromDate || dr.toDate) ? ((dr.fromDate || '…') + ' تا ' + (dr.toDate || '…')) : 'همه زمان‌ها')], []);
            var ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }];
            var wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
            XLSX.utils.book_append_sheet(wb, ws, 'تیل و میتر');
            var fname = 'گزارش_تیل_و_میتر'; try { fname += '_' + new PersianDate().format('YYYYMMDD_HHmmss'); } catch (e) { fname += '_' + Date.now(); }
            XLSX.writeFile(wb, fname + '.xlsx');
            try { if (typeof _rpAfterExcelSaved === 'function') _rpAfterExcelSaved(fname + '.xlsx'); } catch (e) {}
        } catch (e) { msg('خطا', 'خطا در ساخت فایل اکسل: ' + (e && e.message ? e.message : e)); }
    };
    PS.meterReportPdf = function () {
        var dr = currentRange();
        var aoa = meterReportAOA(meterReportData(dr.fromDate, dr.toDate));
        var title = 'گزارش تیل و میترها';
        var rowsHtml = aoa.map(function (r) {
            if (!r.length) return '<tr class="g"><td colspan="9"></td></tr>';
            if (r.length === 1) return '<tr class="t"><th colspan="9">' + esc(r[0]) + '</th></tr>';
            var head = (r[0] === 'نوع تیل' || r[0] === 'نام میتر');
            return '<tr' + (head ? ' class="h"' : '') + '>' + r.map(function (c) { return (head ? '<th>' : '<td>') + esc(typeof c === 'number' ? fmt(c) : c) + (head ? '</th>' : '</td>'); }).join('') + '</tr>';
        }).join('');
        var range = (dr.fromDate || dr.toDate) ? ((dr.fromDate || '…') + ' تا ' + (dr.toDate || '…')) : 'همه زمان‌ها';
        var html = '<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page{size:A4;margin:12mm;}body{font-family:Vazirmatn,Tahoma,sans-serif;direction:rtl;color:#1e293b;}h2{color:#1e3a5f;margin:0 0 4px;}.m{color:#64748b;font-size:12px;margin-bottom:12px;}table{width:100%;border-collapse:collapse;font-size:12px;}td,th{border:1px solid #cbd5e1;padding:6px 8px;text-align:right;}tr.h th{background:#1e3a5f;color:#fff;}tr.t th{background:#e2e8f0;text-align:right;}tr.g td{border:none;height:10px;}</style></head><body>' +
            '<h2>' + esc(title) + '</h2><div class="m">بازه: ' + esc(range) + '</div><table>' + rowsHtml + '</table></body></html>';
        try { __openPrintPreview(html, { title: title, text: title, assets: true, topBar: true, pdfName: title }); }
        catch (e) { var w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } }
    };
    PS.showMeterReport = showMeterReport;
    wrap('onReportSectionChange', function (r, value) {
        var w = $('rp-persons-card-wrap');
        if (value === 'meters' && w) { w.style.display = 'block'; }
    });
    var _origCalcReport = window.calculateNewReport;
    window.calculateNewReport = function () {
        var sec = ($('report-section-select') || {}).value || '';
        if (sec === 'meters') { showMeterReport(); return; }
        return _origCalcReport.apply(this, arguments);
    };
    wrap('calculateAllSectionsReport', function (r, fromDate, toDate) {
        var w = $('rp-persons-card-wrap'); if (!w) return;
        try { w.insertAdjacentHTML('beforeend', meterReportCardHtml(meterReportData(fromDate, toDate))); applyDigits(); } catch (e) {}
    });

    // =============================================================================
    //  آغاز
    // =============================================================================
    function boot() {
        try {
            seedDefaults();
            // سطرهای ایستای HTML → سطرهای کارتی
            ['sales', 'purchase'].forEach(function (k) {
                var isP = (k === 'purchase');
                var tb = bodyOf(isP);
                if (tb && !tb.querySelector('.ps-row')) { tb.innerHTML = ''; addRow(isP); }
            });
            // تبِ پیش‌فرض
            if (sectionActive('products-list')) psSwitchTab('tanks');
            // نام و آیکنِ پیش‌فرض
            try { if (sectionActive('dashboard') && typeof ndRenderDashboard === 'function') ndRenderDashboard(); } catch (e) {}
        } catch (e) { console.warn('pump boot:', e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
    else setTimeout(boot, 50);
    // پس از همگام‌سازی/بازیابی، اگر بخش‌های پمپ باز هستند تازه شوند
    window.addEventListener('storage', function (e) {
        if (!e || !e.key) return;
        if (/meters|meterReadings/.test(e.key)) { try { if (sectionActive('products-list') && currentTab() === 'meters') renderMeters(); if (sectionActive('meter-readings-list')) renderReadings(); renderDashMeters(); } catch (x) {} }
    });

    PS.version = '1.0.0';
})();
