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
