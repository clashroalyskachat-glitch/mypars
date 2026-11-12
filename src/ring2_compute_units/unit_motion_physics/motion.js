/*
 * Живая подсветка вкладок в доке дней.
 *
 * Единственное, что взято из экспериментов с дизайном: капсула активной
 * вкладки не появляется мгновенно, а перетекает от старой к новой,
 * вытягиваясь в полёте. Всё остальное оформление — прежнее.
 *
 * Капсула лежит внутри #days-tabs (z-index: 0), поэтому подписи вкладок
 * всегда остаются сверху и не размываются.
 */
(function () {
    'use strict';

    var pill = null;
    var anim = null;

    function getTabs() {
        return document.getElementById('days-tabs');
    }

    function box(container, el) {
        var c = container.getBoundingClientRect();
        var r = el.getBoundingClientRect();
        return {
            left: r.left - c.left,
            top: r.top - c.top,
            width: r.width,
            height: r.height
        };
    }

    function place(el, b) {
        el.style.left = b.left + 'px';
        el.style.top = b.top + 'px';
        el.style.width = b.width + 'px';
        el.style.height = b.height + 'px';
    }

    function ensurePill(tabs) {
        var found = tabs.querySelector('.dock-pill');
        if (found) return found;

        found = document.createElement('span');
        found.className = 'dock-pill';
        tabs.insertBefore(found, tabs.firstChild);
        return found;
    }

    function stop() {
        if (anim) {
            try { anim.cancel(); } catch (e) { /* уже снята */ }
            anim = null;
        }
    }

    document.addEventListener('click', function (event) {
        var tab = event.target && event.target.closest ? event.target.closest('#days-tabs .day-tab') : null;
        if (!tab) return;

        var tabs = getTabs();
        if (!tabs) return;

        var old = tabs.querySelector('.day-tab-active');
        if (!old || old === tab) return;

        var from = box(tabs, old);
        var wanted = tab;

        stop();

        /* приложение перерисовывает вкладки в этом же клике — ждём кадр */
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                var current = getTabs();
                if (!current) return;

                var active = current.querySelector('.day-tab-active') || wanted;
                var to = box(current, active);

                pill = ensurePill(current);
                place(pill, from);
                pill.style.transform = 'scaleY(1)';
                pill.style.opacity = '1';

                current.classList.add('dock-moving');

                var rightwards = to.left >= from.left;
                var lag = rightwards ? 0.26 : 0.74;
                var lead = rightwards ? 0.74 : 0.26;

                var fromRight = from.left + from.width;
                var toRight = to.left + to.width;
                var midLeft = from.left + (to.left - from.left) * lag;
                var midRight = fromRight + (toRight - fromRight) * lead;

                anim = pill.animate([
                    {
                        left: from.left + 'px',
                        top: from.top + 'px',
                        width: from.width + 'px',
                        height: from.height + 'px',
                        transform: 'scaleY(1)'
                    },
                    {
                        left: midLeft + 'px',
                        top: from.top + 'px',
                        width: (midRight - midLeft) + 'px',
                        height: from.height + 'px',
                        transform: 'scaleY(.93)',
                        offset: 0.5
                    },
                    {
                        left: to.left + 'px',
                        top: to.top + 'px',
                        width: to.width + 'px',
                        height: to.height + 'px',
                        transform: 'scaleY(1)'
                    }
                ], {
                    duration: 620,
                    easing: 'cubic-bezier(.32, .82, .24, 1)',
                    fill: 'forwards'
                });

                anim.onfinish = function () {
                    place(pill, to);
                    pill.style.transform = 'scaleY(1)';
                    pill.style.opacity = '0';
                    current.classList.remove('dock-moving');
                    anim = null;
                };
            });
        });
    }, true);
})();

/*
 * Плавное колесо мыши — только на ПК.
 *
 * Нативный wheel в Windows прыгает сразу на ~100 px. Здесь мы копим цель и
 * догоняем её через rAF с экспоненциальным сглаживанием (~65 мс). Это не
 * «инерция на полсекунды»: движение заканчивается примерно за 200 мс, поэтому
 * нет ощущения задержки ввода.
 *
 * Телефоны, планшеты и тачпады не трогаем — у них уже есть нативный
 * инерционный скролл. Внутренние списки (группы, поиск, настройки) и
 * горизонтальные вкладки тоже остаются нативными.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
    // Только точный указатель (мышь). Телефоны/планшеты не трогаем.
    // prefers-reduced-motion здесь намеренно не проверяем: это не декоративная
    // анимация, а короткое (≈200 мс) сглаживание прямого управления скроллом.
    if (!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)) return;

    var SCROLLERS = '.group-list, #search-results, .settings-body, #days-tabs';
    var EASE_MS = 65; // меньше — резче, больше — «плывёт»
    var PREF_KEY = 'nkse-pref-smooth-wheel';

    var enabled = true;
    try {
        if (localStorage.getItem(PREF_KEY) === '0') enabled = false;
    } catch (e) { /* приватный режим */ }

    var target = window.scrollY || 0;
    var current = target;
    var raf = 0;
    var last = 0;

    function stopAnim() {
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
    }

    function maxY() {
        var doc = document.documentElement;
        return Math.max(0, doc.scrollHeight - window.innerHeight);
    }

    function clampY(y) {
        var m = maxY();
        return y < 0 ? 0 : (y > m ? m : y);
    }

    function inNativeScroller(node) {
        return !!(node && node.closest && node.closest(SCROLLERS));
    }

    function tick(now) {
        var dt = now - last;
        last = now;
        if (!(dt > 0)) dt = 16;
        if (dt > 64) dt = 64;

        current += (target - current) * (1 - Math.exp(-dt / EASE_MS));

        if (Math.abs(target - current) < 0.5) {
            current = target;
            window.scrollTo(0, current);
            raf = 0;
            return;
        }
        window.scrollTo(0, current);
        raf = requestAnimationFrame(tick);
    }

    // Настройки — фиксированная панель поверх страницы. Колесо внутри её
    // списка оставляем нативным, а над шапкой/фоном не даём прокручивать
    // страницу под панелью.
    function modalOpen() {
        var panel = document.getElementById('settings-panel');
        return !!(panel && !panel.hidden);
    }

    window.addEventListener('wheel', function (event) {
        if (!enabled) return;
        if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
        if (modalOpen()) {
            if (!(event.target && event.target.closest && event.target.closest('.settings-body'))) {
                event.preventDefault();
            }
            return;
        }
        if (inNativeScroller(event.target)) return;

        var dy = event.deltaY;
        if (!dy) return;
        if (event.deltaMode === 1) dy *= 16;
        else if (event.deltaMode === 2) dy *= window.innerHeight;

        // Мелкие дельты — тачпад или хвост инерции: там нативный скролл уже
        // плавный, не вмешиваемся.
        if (Math.abs(dy) < 24) return;

        // Горизонтальный жест не перехватываем.
        if (Math.abs(event.deltaX) > Math.abs(dy)) return;

        event.preventDefault();

        if (!raf) {
            current = window.scrollY || 0;
            target = current;
            last = performance.now();
        }
        target = clampY(target + dy);
        if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: false });

    // Любой не-колёсный скролл (клавиатура, скроллбар, якорь) синхронизируем,
    // чтобы следующий щелчок колеса не прыгал назад.
    window.addEventListener('scroll', function () {
        if (raf) return;
        target = current = window.scrollY || 0;
    }, { passive: true });

    window.addEventListener('resize', function () {
        target = clampY(target);
        current = clampY(current);
    }, { passive: true });

    // Переключатель из настроек: выключаем сглаживание без перезагрузки.
    window.NKSEScroll = {
        setEnabled: function (v) {
            enabled = !!v;
            if (!enabled) stopAnim();
        },
        isEnabled: function () { return enabled; }
    };
})();
