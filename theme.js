/*
 * NKSE theme engine.
 *
 * Loaded in <head> before the page is painted: reads the saved theme from
 * localStorage and writes the tokens as CSS variables on <html>, so there is
 * no flash of the wrong theme.
 *
 * Everything is local: theme state + presets in localStorage, uploaded
 * background images in IndexedDB.
 */
(function () {
    'use strict';

    var STATE_KEY = 'nkse-theme-state-v1';
    var PRESET_KEY = 'nkse-theme-presets-v1';
    var LEGACY_KEY = 'nkse-theme-v2';
    var DB_NAME = 'nkse-theme-db';
    var DB_STORE = 'images';

    var DEFAULTS = {
        dark: {
            bg: '#000000',
            surface: '#000000',
            surface2: '#0b0f19',
            text: '#ffffff',
            muted: '#9ca3af',
            accent: '#a855f7',
            accentContrast: '#ffffff',
            border: '#ffffff',
            borderStrong: '#ffffff',
            softBorder: 'rgba(148,163,184,0.45)',
            panelBorder: 'rgba(255,255,255,0.16)',
            warning: '#f59e0b',
            success: '#10b981',
            danger: '#ef4444',
            lessonBg: '#000000',
            lessonBgHover: '#000000',
            lessonBorder: 'rgba(255,255,255,0.70)',
            roomBorder: 'rgba(255,255,255,0.55)',
            tabBg: '#000000',
            tabPillBg: '#000000',
            tabPillBorder: '#ffffff',
            tabActiveBg: 'transparent',
            tabActiveText: '#a855f7',
            tabActiveBorder: '#a855f7',
            headerBg: '#000000',
            footerBg: '#000000',
            inputBg: 'transparent',
            chipBg: 'transparent',
            nowBg: 'transparent'
        },
        light: {
            bg: '#eef1f6',
            surface: '#ffffff',
            surface2: '#f8fafc',
            text: '#1e293b',
            muted: '#64748b',
            accent: '#a855f7',
            accentContrast: '#ffffff',
            border: '#d7e0ec',
            borderStrong: '#c7d2e2',
            softBorder: 'rgba(100,116,139,0.42)',
            panelBorder: 'rgba(100,116,139,0.28)',
            warning: '#f59e0b',
            success: '#10b981',
            danger: '#ef4444',
            lessonBg: '#fdfdfe',
            lessonBgHover: '#ffffff',
            lessonBorder: '#dbe3ee',
            roomBorder: 'rgba(100,116,139,0.42)',
            tabBg: '#e8edf4',
            tabPillBg: 'rgba(255,255,255,0.60)',
            tabPillBorder: 'rgba(100,116,139,0.30)',
            tabActiveBg: '#2563eb',
            tabActiveText: '#ffffff',
            tabActiveBorder: '#2563eb',
            headerBg: 'rgba(255,255,255,0.94)',
            footerBg: '#ffffff',
            inputBg: '#ffffff',
            chipBg: 'rgba(241,245,249,0.90)',
            nowBg: '#ffffff'
        }
    };

    var METRIC_DEFAULTS = {
        radius: 18,
        spaceScale: 1.0,
        textScale: 1.0,
        lineHeight: 1.42,
        border: 1,
        cardOpacity: 1.0,
        glow: 0,
        displayFont: 'sans',
        motion: true
    };

    var COLOR_VARS = {
        bg: '--t-bg',
        surface: '--t-surface',
        surface2: '--t-surface-2',
        text: '--t-text',
        muted: '--t-muted',
        accent: '--t-accent',
        accentContrast: '--t-accent-contrast',
        border: '--t-border',
        borderStrong: '--t-border-strong',
        softBorder: '--t-soft-border',
        panelBorder: '--t-panel-border',
        warning: '--t-warning',
        success: '--t-success',
        danger: '--t-danger',
        lessonBg: '--t-lesson-bg',
        lessonBgHover: '--t-lesson-bg-hover',
        lessonBorder: '--t-lesson-border',
        roomBorder: '--t-room-border',
        tabBg: '--t-tab-bg',
        tabPillBg: '--t-tab-pill-bg',
        tabPillBorder: '--t-tab-pill-border',
        tabActiveBg: '--t-tab-active-bg',
        tabActiveText: '--t-tab-active-text',
        tabActiveBorder: '--t-tab-active-border',
        headerBg: '--t-header-bg',
        footerBg: '--t-footer-bg',
        inputBg: '--t-input-bg',
        chipBg: '--t-chip-bg',
        nowBg: '--t-now-bg'
    };

    var COLOR_LIST = [
        ['bg', 'Фон страницы'],
        ['surface', 'Карточка дня'],
        ['surface2', 'Панели и плашки'],
        ['lessonBg', 'Карточка пары'],
        ['text', 'Основной текст'],
        ['muted', 'Второстепенный текст'],
        ['accent', 'Акцент'],
        ['border', 'Границы'],
        ['warning', 'Замены'],
        ['tabBg', 'Полоса дней'],
        ['tabActiveBg', 'Активный день']
    ];

    var PRESET_DEFS = [
        { id: 'dark', name: 'НКСЭ Тёмная', mode: 'dark' },
        { id: 'light', name: 'НКСЭ Светлая', mode: 'light' },
        {
            id: 'paper',
            name: 'Бумага',
            mode: 'light',
            colors: {
                bg: '#f4f1e8', surface: '#fffdf6', surface2: '#fbf7ec', text: '#2b2a26',
                muted: '#786f5e', accent: '#7c3aed', border: '#ddd6c4', borderStrong: '#c9c0a9',
                softBorder: '#d8d0bc', lessonBg: '#fffdf6', lessonBgHover: '#ffffff',
                lessonBorder: '#e3dccb', roomBorder: '#cfc6b2', tabBg: '#eee9db',
                tabPillBg: '#fffdf6', tabPillBorder: '#d8d0bc', tabActiveBg: '#7c3aed',
                tabActiveText: '#ffffff', tabActiveBorder: '#7c3aed', headerBg: '#fbf8f0',
                footerBg: '#fbf8f0', chipBg: 'rgba(120,111,94,0.10)', nowBg: '#fffdf6'
            },
            metrics: { radius: 10, lineHeight: 1.5 }
        },
        {
            id: 'contrast',
            name: 'Контраст',
            mode: 'light',
            colors: {
                bg: '#ffffff', surface: '#ffffff', surface2: '#f5f5f5', text: '#000000',
                muted: '#3f3f46', accent: '#000000', accentContrast: '#ffffff',
                border: '#000000', borderStrong: '#000000', softBorder: '#000000',
                warning: '#b45309', lessonBg: '#ffffff', lessonBgHover: '#ffffff',
                lessonBorder: '#000000', roomBorder: '#000000', tabBg: '#ffffff',
                tabPillBg: '#ffffff', tabPillBorder: '#000000', tabActiveBg: '#000000',
                tabActiveText: '#ffffff', tabActiveBorder: '#000000', headerBg: '#ffffff',
                footerBg: '#ffffff', chipBg: '#ffffff', nowBg: '#ffffff'
            },
            metrics: { radius: 6, border: 2, textScale: 1.06, lineHeight: 1.5 }
        },
        {
            id: 'compact',
            name: 'Компакт',
            mode: 'dark',
            metrics: { radius: 12, spaceScale: 0.82, textScale: 0.92 }
        },
        {
            id: 'cozy',
            name: 'Уютная',
            mode: 'light',
            colors: {
                bg: '#f7f2ff', surface: '#ffffff', surface2: '#fdfbff', text: '#2b2140',
                muted: '#6b5c86', accent: '#7c3aed', border: '#e8def8', borderStrong: '#d8c9f2',
                softBorder: '#e3d8f5', lessonBg: '#ffffff', lessonBgHover: '#ffffff',
                lessonBorder: '#ede5fa', roomBorder: '#d9cdef', tabBg: '#f0e9ff',
                tabPillBg: '#ffffff', tabPillBorder: '#e0d4f5', tabActiveBg: '#7c3aed',
                tabActiveText: '#ffffff', tabActiveBorder: '#7c3aed', headerBg: '#fdfbff',
                footerBg: '#fdfbff', chipBg: 'rgba(124,58,237,0.08)', nowBg: '#ffffff'
            },
            metrics: { radius: 26, spaceScale: 1.12, textScale: 1.04, lineHeight: 1.5 }
        },
        {
            id: 'neon',
            name: 'Неон',
            mode: 'dark',
            colors: {
                bg: '#05010f', surface: '#080315', surface2: '#0d0620', text: '#f5f3ff',
                muted: '#a99fca', accent: '#22d3ee', accentContrast: '#041016',
                border: 'rgba(34,211,238,0.35)', borderStrong: 'rgba(34,211,238,0.65)',
                softBorder: 'rgba(34,211,238,0.28)', warning: '#fb7185',
                lessonBg: '#080315', lessonBgHover: '#0b0420', lessonBorder: 'rgba(34,211,238,0.30)',
                roomBorder: 'rgba(34,211,238,0.40)', tabBg: '#080315', tabPillBg: '#080315',
                tabPillBorder: 'rgba(34,211,238,0.45)', tabActiveBg: 'transparent',
                tabActiveText: '#22d3ee', tabActiveBorder: '#22d3ee', headerBg: '#05010f',
                footerBg: '#05010f', chipBg: 'rgba(34,211,238,0.10)', nowBg: '#080315'
            },
            metrics: { radius: 18, glow: 10 }
        },
        {
            id: 'calm',
            name: 'Спокойная',
            mode: 'light',
            colors: {
                bg: '#f3f4f6', surface: '#ffffff', surface2: '#fafafa', text: '#334155',
                muted: '#64748b', accent: '#64748b', border: '#e2e8f0', borderStrong: '#cbd5e1',
                softBorder: '#d8dee8', lessonBg: '#fbfcfd', lessonBgHover: '#ffffff',
                lessonBorder: '#e5eaf1', roomBorder: '#cbd5e1', tabBg: '#e9edf3',
                tabPillBg: '#ffffff', tabPillBorder: '#e2e8f0', tabActiveBg: '#64748b',
                tabActiveText: '#ffffff', tabActiveBorder: '#64748b', headerBg: '#fbfcfd',
                footerBg: '#fbfcfd', chipBg: 'rgba(100,116,139,0.08)', nowBg: '#ffffff'
            },
            metrics: { radius: 14, motion: false }
        },
        {
            id: 'akashi',
            name: 'Акаши',
            mode: 'dark',
            fx: 'akashi',
            colors: {
                bg: '#050000', surface: '#080000', surface2: '#160309',
                text: '#fff5f2', muted: '#c98a96',
                accent: '#ff0038', accentContrast: '#ffffff',
                border: 'rgba(255,0,56,0.55)', borderStrong: '#ff5c75',
                softBorder: 'rgba(255,0,56,0.32)', panelBorder: 'rgba(255,0,56,0.35)',
                warning: '#ffd166', success: '#ffd166', danger: '#ff2e3f',
                lessonBg: '#080000', lessonBgHover: '#14020a',
                lessonBorder: 'rgba(255,0,56,0.40)', roomBorder: 'rgba(255,209,102,0.60)',
                tabBg: '#070000', tabPillBg: '#070000',
                tabPillBorder: 'rgba(255,0,56,0.40)', tabActiveBg: '#ff0038',
                tabActiveText: '#ffffff', tabActiveBorder: '#ff5c75',
                headerBg: '#050000', footerBg: '#050000',
                inputBg: 'transparent', chipBg: 'rgba(255,255,255,0.035)',
                nowBg: 'rgba(8,0,3,0.90)'
            },
            metrics: {
                radius: 6,
                spaceScale: 1.0,
                textScale: 1.0,
                lineHeight: 1.4,
                border: 1,
                cardOpacity: 0.82,
                glow: 8,
                displayFont: 'sans',
                motion: true
            },
            background: {
                url: 'assets/akashi-desktop.jpg',
                mobileUrl: 'assets/akashi-phone.jpg',
                fit: 'cover',
                position: 'center',
                dim: 0.08
            }
        }
    ];

    var SOUND_PACKS = {
        soft: { type: 'sine', base: 660, gain: 0.035, dur: 0.07, gap: 0.035 },
        click: { type: 'triangle', base: 1100, gain: 0.04, dur: 0.035, gap: 0.02 },
        retro: { type: 'square', base: 520, gain: 0.025, dur: 0.06, gap: 0.03 }
    };

    var audioCtx = null;
    var lastSound = 0;
    var runtimeImageUrl = '';

    /* ---------------- storage ---------------- */

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function defaultState(mode) {
        return {
            version: 1,
            mode: mode === 'light' ? 'light' : 'dark',
            preset: mode === 'light' ? 'light' : 'dark',
            fx: 'none',
            tokens: clone(DEFAULTS[mode === 'light' ? 'light' : 'dark']),
            metrics: clone(METRIC_DEFAULTS),
            background: {
                type: 'none',
                color: DEFAULTS[mode === 'light' ? 'light' : 'dark'].bg,
                from: '#111827',
                to: '#000000',
                angle: 135,
                url: '',
                mobileUrl: '',
                imageId: '',
                fit: 'cover',
                position: 'center',
                dim: 0.35
            },
            sound: { enabled: false, volume: 55, pack: 'soft' }
        };
    }

    function normalize(raw) {
        if (!raw || typeof raw !== 'object') return defaultState('dark');
        var mode = raw.mode === 'light' ? 'light' : 'dark';
        var out = defaultState(mode);

        if (raw.tokens && typeof raw.tokens === 'object') {
            Object.keys(out.tokens).forEach(function (k) {
                if (typeof raw.tokens[k] === 'string' && raw.tokens[k]) out.tokens[k] = raw.tokens[k];
            });
        }
        if (raw.metrics && typeof raw.metrics === 'object') {
            Object.keys(out.metrics).forEach(function (k) {
                var v = raw.metrics[k];
                if (typeof v === 'boolean') out.metrics[k] = v;
                else if (typeof v === 'number' && isFinite(v)) out.metrics[k] = v;
            });
        }
        out.metrics.radius = clamp(out.metrics.radius, 0, 32);
        out.metrics.spaceScale = clamp(out.metrics.spaceScale, 0.7, 1.5);
        out.metrics.textScale = clamp(out.metrics.textScale, 0.85, 1.3);
        out.metrics.lineHeight = clamp(out.metrics.lineHeight, 1.2, 1.8);
        out.metrics.border = clamp(out.metrics.border, 0, 3);
        out.metrics.cardOpacity = clamp(out.metrics.cardOpacity, 0.5, 1);
        out.metrics.glow = clamp(out.metrics.glow, 0, 30);
        out.metrics.displayFont = raw.metrics && raw.metrics.displayFont === 'serif' ? 'serif' : 'sans';
        out.fx = raw.fx === 'akashi' ? 'akashi' : 'none';

        if (raw.background && typeof raw.background === 'object') {
            var bg = raw.background;
            out.background.type = ['none', 'color', 'gradient', 'image'].indexOf(bg.type) >= 0 ? bg.type : 'none';
            ['color', 'from', 'to', 'url', 'mobileUrl', 'imageId', 'fit', 'position'].forEach(function (k) {
                if (typeof bg[k] === 'string') out.background[k] = bg[k];
            });
            if (typeof bg.dim === 'number' && isFinite(bg.dim)) out.background.dim = clamp(bg.dim, 0, 0.9);
            if (typeof bg.angle === 'number' && isFinite(bg.angle)) out.background.angle = clamp(bg.angle, 0, 360);
        }

        if (raw.sound && typeof raw.sound === 'object') {
            out.sound.enabled = !!raw.sound.enabled;
            if (typeof raw.sound.volume === 'number' && isFinite(raw.sound.volume)) out.sound.volume = clamp(raw.sound.volume, 0, 100);
            if (SOUND_PACKS[raw.sound.pack]) out.sound.pack = raw.sound.pack;
        }
        out.preset = typeof raw.preset === 'string' ? raw.preset : 'custom';
        return out;
    }

    function loadState() {
        try {
            var raw = localStorage.getItem(STATE_KEY);
            if (raw) return normalize(JSON.parse(raw));
            var old = localStorage.getItem(LEGACY_KEY);
            if (old) return defaultState(old === 'light' ? 'light' : 'dark');
            // New visitors see the Akashi theme; the original dark/light
            // themes are still in the preset list.
            var akashi = PRESET_DEFS.filter(function (p) { return p.id === 'akashi'; })[0];
            if (akashi) return presetState(akashi);
            return defaultState('dark');
        } catch (e) {
            return defaultState('dark');
        }
    }

    function loadUserPresets() {
        try {
            var v = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
            return Array.isArray(v) ? v.filter(function (p) { return p && typeof p.id === 'string' && p.state; }) : [];
        } catch (e) {
            return [];
        }
    }

    var state = loadState();
    var userPresets = loadUserPresets();
    var saveTimer = null;

    function saveSoon() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function () {
            saveTimer = null;
            try {
                localStorage.setItem(STATE_KEY, JSON.stringify(state));
                localStorage.removeItem(LEGACY_KEY);
            } catch (e) {}
            document.dispatchEvent(new CustomEvent('nkse-theme-saved', { detail: { state: state } }));
        }, 180);
    }

    function saveUserPresets() {
        try {
            localStorage.setItem(PRESET_KEY, JSON.stringify(userPresets));
        } catch (e) {}
    }

    /* ---------------- helpers ---------------- */

    function clamp(n, min, max) {
        return Math.min(max, Math.max(min, n));
    }

    function hexToRgba(color, alpha) {
        if (!color) return 'rgba(0,0,0,' + alpha + ')';
        var c = String(color).trim();
        if (c.indexOf('rgba') === 0 || c.indexOf('rgb') === 0) {
            return c.replace(/rgba?\(([^)]+)\)/, function (m, body) {
                var parts = body.split(',').map(function (x) { return parseFloat(x); });
                return 'rgba(' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',' + alpha + ')';
            });
        }
        var m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!m) return 'rgba(0,0,0,' + alpha + ')';
        var h = m[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.slice(0, 2), 16);
        var g = parseInt(h.slice(2, 4), 16);
        var b = parseInt(h.slice(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function cssUrl(url) {
        return 'url("' + String(url).replace(/"/g, '%22') + '")';
    }

    function isImageUrl(u) {
        if (!u) return false;
        return /^(https?:\/\/|data:image\/|\.{0,2}\/|\/|[\w-]+\/)/i.test(u) ||
            /^[\w.-]+\.(png|jpe?g|webp|svg|gif)$/i.test(u);
    }

    function contrastText(color) {
        var hex = hexToRgba(color, 1);
        var m = hex.match(/rgba\(([^)]+)\)/);
        if (!m) return '#ffffff';
        var p = m[1].split(',').map(Number);
        var lum = (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255;
        return lum > 0.62 ? '#000000' : '#ffffff';
    }

    function fitCss(fit) {
        if (fit === 'contain') return { size: 'contain', repeat: 'no-repeat' };
        if (fit === 'repeat') return { size: 'auto', repeat: 'repeat' };
        return { size: 'cover', repeat: 'no-repeat' };
    }

    /* ---------------- apply ---------------- */

    function applyBackground() {
        var root = document.documentElement;
        var bg = state.background || {};
        var type = bg.type || 'none';
        var image = '';
        var size = 'cover';
        var repeat = 'no-repeat';
        var pos = bg.position || 'center';

        if (type === 'gradient') {
            image = 'linear-gradient(' + (bg.angle || 135) + 'deg, ' + (bg.from || '#111827') + ', ' + (bg.to || '#000000') + ')';
        } else if (type === 'image') {
            var mobile = !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
            var url = '';
            if (mobile && bg.mobileUrl) url = bg.mobileUrl;
            else if (bg.url) url = bg.url;
            else if (bg.mobileUrl) url = bg.mobileUrl;
            else url = runtimeImageUrl;
            if (url) {
                var fit = fitCss(bg.fit);
                size = fit.size;
                repeat = fit.repeat;
                image = 'linear-gradient(rgba(0,0,0,' + (bg.dim || 0) + '), rgba(0,0,0,' + (bg.dim || 0) + ')), ' + cssUrl(url);
            } else {
                type = 'none';
            }
        }

        root.style.setProperty('--t-bg-image', image || 'none');
        root.style.setProperty('--t-bg-size', size);
        root.style.setProperty('--t-bg-repeat', repeat);
        root.style.setProperty('--t-bg-position', pos);
        root.setAttribute('data-bg', type);
    }

    function apply() {
        var root = document.documentElement;
        root.setAttribute('data-theme', state.mode);

        var tokens = state.tokens;
        Object.keys(COLOR_VARS).forEach(function (k) {
            if (tokens[k]) root.style.setProperty(COLOR_VARS[k], tokens[k]);
        });
        root.style.setProperty('--t-accent-soft', hexToRgba(tokens.accent, 0.14));
        root.style.setProperty('--t-accent-border', hexToRgba(tokens.accent, 0.55));
        root.style.setProperty('--t-warning-soft', hexToRgba(tokens.warning, 0.16));
        root.style.setProperty('--t-danger-soft', hexToRgba(tokens.danger, 0.14));

        var m = state.metrics;
        root.style.setProperty('--t-radius', String(m.radius));
        root.style.setProperty('--t-space-scale', String(m.spaceScale));
        root.style.setProperty('--t-text-scale', String(m.textScale));
        root.style.setProperty('--t-border-w', String(m.border));
        root.style.setProperty('--t-line-height', String(m.lineHeight));
        root.style.setProperty('--t-card-bg', hexToRgba(tokens.surface, m.cardOpacity));
        root.style.setProperty('--t-lesson-card-bg', hexToRgba(tokens.lessonBg, m.cardOpacity));
        root.style.setProperty('--t-lesson-card-bg-hover', hexToRgba(tokens.lessonBgHover, m.cardOpacity));
        root.style.setProperty('--t-display-font', m.displayFont === 'serif' ? "Georgia, 'Times New Roman', 'Noto Serif', serif" : 'inherit');
        root.style.setProperty('--t-glow', String(m.glow || 0));
        root.setAttribute('data-glow', m.glow > 0 ? 'on' : 'off');
        root.setAttribute('data-fx', state.fx || 'none');
        root.setAttribute('data-motion', m.motion ? 'on' : 'off');

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', tokens.bg);

        applyBackground();
    }

    function announce() {
        document.dispatchEvent(new CustomEvent('nkse-theme-change', { detail: { state: state } }));
    }

    function changed() {
        apply();
        saveSoon();
        announce();
    }

    /* ---------------- presets ---------------- */

    function presetState(def) {
        var base = defaultState(def.mode || 'dark');
        var colors = def.colors || {};
        var metrics = def.metrics || {};
        Object.keys(colors).forEach(function (k) { base.tokens[k] = colors[k]; });
        Object.keys(metrics).forEach(function (k) { base.metrics[k] = metrics[k]; });
        base.mode = def.mode || 'dark';
        base.preset = def.id;
        base.fx = def.fx || 'none';
        // built-ins may ship a generated background (the Akashi preset does)
        if (def.background) {
            var b = def.background;
            base.background.type = 'image';
            base.background.imageId = '';
            base.background.fit = b.fit || 'cover';
            base.background.position = b.position || 'center';
            base.background.dim = typeof b.dim === 'number' ? b.dim : 0.18;
            base.background.url = b.svg
                ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(b.svg)
                : b.url || '';
            base.background.mobileUrl = b.mobileUrl || '';
        } else {
            base.background.type = 'none';
            base.background.color = base.tokens.bg;
        }
        base.metrics = normalize({ metrics: base.metrics, mode: base.mode }).metrics;
        return normalize(base);
    }

    function getPresets() {
        return PRESET_DEFS.map(function (p) {
            return { id: p.id, name: p.name, builtin: true, mode: p.mode };
        }).concat(userPresets.map(function (p) {
            return { id: p.id, name: p.name, builtin: false, mode: p.state.mode };
        }));
    }

    function getPresetColors(id) {
        var def = PRESET_DEFS.filter(function (p) { return p.id === id; })[0];
        var st = null;
        if (def) st = presetState(def);
        else {
            var user = userPresets.filter(function (p) { return p.id === id; })[0];
            if (user) st = normalize(clone(user.state));
        }
        if (!st) st = state;
        return {
            bg: st.tokens.bg,
            surface: st.tokens.surface,
            accent: st.tokens.accent,
            text: st.tokens.text
        };
    }

    function applyPreset(id, opts) {
        var def = PRESET_DEFS.filter(function (p) { return p.id === id; })[0];
        var next = null;
        if (def) {
            next = presetState(def);
            // keep sound preferences across theme switches
            next.sound = clone(state.sound);
        } else {
            var user = userPresets.filter(function (p) { return p.id === id; })[0];
            if (!user) return false;
            next = normalize(clone(user.state));
            next.sound = clone(state.sound);
            next.preset = id;
        }
        state = next;
        runtimeImageUrl = '';
        if (state.background.imageId) loadStoredImage(state.background.imageId);
        changed();
        return true;
    }

    function savePreset(name) {
        var clean = String(name || '').trim();
        if (!clean) return null;
        var id = 'user-' + Date.now().toString(36);
        var copy = normalize(clone(state));
        copy.preset = id;
        userPresets.push({ id: id, name: clean, state: copy });
        saveUserPresets();
        state.preset = id;
        saveSoon();
        announce();
        return id;
    }

    function deletePreset(id) {
        userPresets = userPresets.filter(function (p) { return p.id !== id; });
        saveUserPresets();
        if (state.preset === id) {
            state.preset = 'custom';
            saveSoon();
        }
        announce();
    }

    /* ---------------- share codes ---------------- */

    function b64urlEncode(str) {
        var b64 = btoa(unescape(encodeURIComponent(str)));
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function b64urlDecode(str) {
        var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        return decodeURIComponent(escape(atob(s)));
    }

    function presetStateById(id) {
        var def = PRESET_DEFS.filter(function (p) { return p.id === id; })[0];
        if (def) return { st: presetState(def), name: def.name };
        if (id && id !== 'custom') {
            var user = userPresets.filter(function (p) { return p.id === id; })[0];
            if (user) return { st: normalize(clone(user.state)), name: user.name };
        }
        return { st: normalize(clone(state)), name: 'Моя тема' };
    }

    function exportPresetCode(id) {
        var picked = presetStateById(id);
        var st = picked.st;
        var bg = st.background || {};
        var warning = '';
        var load = Promise.resolve('');

        if (bg.type === 'image' && bg.imageId && !bg.url) {
            load = dbGet(bg.imageId).catch(function () { return ''; });
        } else if (bg.type === 'image' && bg.url) {
            load = Promise.resolve(bg.url);
        }

        return load.then(function (imageUrl) {
            var payload = {
                v: 1,
                name: picked.name,
                mode: st.mode,
                fx: st.fx || 'none',
                tokens: clone(st.tokens),
                metrics: clone(st.metrics),
                background: clone(st.background)
            };
            if (imageUrl) {
                if (/^data:image\//i.test(imageUrl)) {
                    if (imageUrl.length > 160000) {
                        warning = 'Фото слишком большое для кода — оно не попало в пресет. Используй ссылку на картинку.';
                        payload.background.type = 'none';
                        payload.background.imageId = '';
                        payload.background.url = '';
                    } else {
                        payload.background.type = 'image';
                        payload.background.dataUrl = imageUrl;
                        payload.background.imageId = '';
                        delete payload.background.url;
                    }
                } else if (isImageUrl(imageUrl)) {
                    payload.background.type = 'image';
                    payload.background.url = imageUrl;
                    payload.background.imageId = '';
                    delete payload.background.dataUrl;
                } else {
                    payload.background.type = 'none';
                    payload.background.imageId = '';
                    payload.background.url = '';
                }
            } else if (payload.background.type === 'image') {
                if (!payload.background.url && !payload.background.mobileUrl) {
                    payload.background.type = 'none';
                    payload.background.imageId = '';
                }
            }
            if (payload.background) delete payload.background.imageId;
            var code = 'NKSE1.' + b64urlEncode(JSON.stringify(payload));
            return { code: code, name: picked.name, warning: warning };
        });
    }

    function importPresetCode(code) {
        return new Promise(function (resolve, reject) {
            var clean = String(code || '').replace(/\s+/g, '');
            if (clean.indexOf('NKSE1.') !== 0) {
                reject(new Error('Это не код пресета (нужен код, начинающийся с NKSE1.)'));
                return;
            }
            var data;
            try {
                data = JSON.parse(b64urlDecode(clean.slice(6)));
            } catch (e) {
                reject(new Error('Код повреждён или скопирован не полностью'));
                return;
            }
            if (!data || data.v !== 1) {
                reject(new Error('Неизвестная версия кода'));
                return;
            }
            var bg = data.background || {};
            var imageData = bg.dataUrl || '';
            var newImageId = imageData ? 'bg-' + Date.now().toString(36) : '';
            var storePromise = imageData
                ? dbPut(newImageId, imageData).then(function () { return newImageId; })
                : Promise.resolve('');
            storePromise.then(function (newId) {
                var raw = {
                    mode: data.mode,
                    tokens: data.tokens,
                    metrics: data.metrics,
                    background: bg,
                    fx: data.fx,
                    preset: 'custom'
                };
                var st = normalize(raw);
                if (newId) {
                    st.background.type = 'image';
                    st.background.imageId = newId;
                    st.background.url = '';
                    runtimeImageUrl = imageData;
                    if (st.background.mobileUrl && !isImageUrl(st.background.mobileUrl)) st.background.mobileUrl = '';
                } else {
                    var okMain = st.background.url && isImageUrl(st.background.url);
                    var okMobile = st.background.mobileUrl && isImageUrl(st.background.mobileUrl);
                    if (okMain || okMobile) {
                        st.background.type = 'image';
                        st.background.imageId = '';
                        if (!okMain) st.background.url = '';
                        if (!okMobile) st.background.mobileUrl = '';
                    } else {
                        st.background.type = 'none';
                        st.background.url = '';
                        st.background.mobileUrl = '';
                        st.background.imageId = '';
                    }
                }
                var name = String(data.name || 'Пресет по коду').slice(0, 40);
                var exists = PRESET_DEFS.some(function (p) { return p.name === name; }) ||
                    userPresets.some(function (p) { return p.name === name; });
                if (exists) name = (name + ' (копия)').slice(0, 40);
                var pid = 'user-' + Date.now().toString(36);
                st.preset = pid;
                userPresets.push({ id: pid, name: name, state: st });
                saveUserPresets();
                state = st;
                if (!newId) runtimeImageUrl = '';
                changed();
                resolve({ id: pid, name: name });
            }).catch(reject);
        });
    }

    /* ---------------- image storage ---------------- */

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbPut(id, value) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put(value, id);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function dbGet(id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DB_STORE, 'readonly');
                var req = tx.objectStore(DB_STORE).get(id);
                req.onsuccess = function () { resolve(req.result || ''); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function dbDelete(id) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).delete(id);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { resolve(); };
            });
        });
    }

    function loadStoredImage(id) {
        dbGet(id).then(function (url) {
            if (!url) return;
            runtimeImageUrl = url;
            if (state.background.imageId === id) applyBackground();
        }).catch(function () {});
    }

    function processImageFile(file) {
        return new Promise(function (resolve, reject) {
            if (!file || !/^image\//.test(file.type)) return reject(new Error('Не картинка'));
            var reader = new FileReader();
            reader.onerror = function () { reject(reader.error || new Error('Не удалось прочитать файл')); };
            reader.onload = function () {
                var img = new Image();
                img.onerror = function () { reject(new Error('Не удалось открыть картинку')); };
                img.onload = function () {
                    var max = 2560;
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    var scale = Math.min(1, max / Math.max(w, h));
                    var canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(w * scale));
                    canvas.height = Math.max(1, Math.round(h * scale));
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    var out;
                    try { out = canvas.toDataURL('image/webp', 0.82); } catch (e) { out = ''; }
                    if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/jpeg', 0.84);
                    resolve(out);
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function setBackgroundImage(dataUrl) {
        var id = 'bg-' + Date.now().toString(36);
        return dbPut(id, dataUrl).then(function () {
            state.background.type = 'image';
            state.background.imageId = id;
            state.background.url = '';
            state.background.mobileUrl = '';
            runtimeImageUrl = dataUrl;
            state.preset = 'custom';
            changed();
            return id;
        });
    }

    /* ---------------- sound ---------------- */

    function audio() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
            return audioCtx;
        }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { audioCtx = new AC(); } catch (e) { audioCtx = null; }
        return audioCtx;
    }

    function soundNotes(kind, pack) {
        var f = pack.base;
        if (kind === 'switch') return [f, f * 1.26];
        if (kind === 'open') return [f * 0.8, f];
        if (kind === 'close') return [f, f * 0.82];
        if (kind === 'success') return [f, f * 1.26, f * 1.58];
        if (kind === 'error') return [f * 0.7, f * 0.58];
        return [f];
    }

    function playWith(kind, packName, force) {
        if (!force && !state.sound.enabled) return;
        var a = audio();
        if (!a) return;
        var now = Date.now();
        if (!force && now - lastSound < 35) return;
        lastSound = now;
        var pack = SOUND_PACKS[packName] || SOUND_PACKS.soft;
        var volume = state.sound.volume / 100;
        var gainValue = pack.gain * volume;
        if (gainValue <= 0) return;
        var notes = soundNotes(kind, pack);
        var t = a.currentTime;
        notes.forEach(function (freq) {
            var osc = a.createOscillator();
            var gain = a.createGain();
            osc.type = pack.type;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + pack.dur);
            osc.connect(gain);
            gain.connect(a.destination);
            osc.start(t);
            osc.stop(t + pack.dur + 0.01);
            t += pack.dur + pack.gap;
        });
    }

    function play(kind) {
        playWith(kind || 'tap', state.sound.pack, false);
    }

    function previewSound(kind, pack) {
        playWith(kind || 'tap', pack || state.sound.pack, true);
    }

    /* ---------------- public API ---------------- */

    function setColor(key, value) {
        if (!COLOR_VARS[key] || !value) return;
        state.tokens[key] = value;
        if (key === 'bg') state.background.color = value;
        if (key === 'border') {
            state.tokens.lessonBorder = value;
            state.tokens.softBorder = value;
            state.tokens.roomBorder = value;
            state.tokens.tabPillBorder = value;
        }
        if (key === 'accent') {
            state.tokens.tabActiveBorder = value;
            state.tokens.accentContrast = contrastText(value);
            state.tokens.tabActiveBg = state.mode === 'light' ? value : 'transparent';
            state.tokens.tabActiveText = state.mode === 'light' ? contrastText(value) : value;
        }
        if (key === 'tabActiveBg') {
            state.tokens.tabActiveText = contrastText(value);
        }
        if (key === 'surface') {
            state.tokens.headerBg = value;
            state.tokens.footerBg = value;
        }
        if (key === 'surface2') state.tokens.nowBg = value;
        state.preset = 'custom';
        changed();
    }

    function setMetric(key, value) {
        if (!(key in state.metrics)) return;
        state.metrics[key] = value;
        state.preset = 'custom';
        changed();
    }

    function setBackground(patch) {
        Object.keys(patch).forEach(function (k) {
            if (k in state.background) state.background[k] = patch[k];
        });
        if (patch.type) state.background.type = patch.type;
        if (patch.url !== undefined && patch.url) {
            state.background.imageId = '';
            runtimeImageUrl = '';
            if (patch.mobileUrl === undefined) state.background.mobileUrl = '';
        }
        state.preset = 'custom';
        changed();
    }

    function setSound(patch) {
        Object.keys(patch).forEach(function (k) {
            if (k in state.sound) state.sound[k] = patch[k];
        });
        saveSoon();
        announce();
    }

    function resetColors() {
        var mode = state.mode;
        state.tokens = clone(DEFAULTS[mode]);
        state.background.color = state.tokens.bg;
        state.preset = 'custom';
        changed();
    }

    function resetMetrics() {
        state.metrics = clone(METRIC_DEFAULTS);
        state.preset = 'custom';
        changed();
    }

    function resetBackground() {
        state.background.type = 'none';
        state.background.url = '';
        state.background.mobileUrl = '';
        state.background.imageId = '';
        runtimeImageUrl = '';
        state.preset = 'custom';
        changed();
    }

    function resetAll() {
        var sound = clone(state.sound);
        state = defaultState('dark');
        state.sound = sound;
        runtimeImageUrl = '';
        changed();
    }

    function exportState() {
        var out = clone(state);
        if (out.background.imageId && runtimeImageUrl) {
            out.background.dataUrl = runtimeImageUrl;
            delete out.background.url;
        }
        return JSON.stringify({ app: 'nkse-schedule', kind: 'theme', state: out, presets: userPresets }, null, 2);
    }

    function importState(text) {
        var data = JSON.parse(text);
        var raw = data && data.state ? data.state : data;
        var next = normalize(raw);
        if (data && Array.isArray(data.presets)) {
            userPresets = data.presets
                .filter(function (p) { return p && typeof p.id === 'string' && p.name && p.state; })
                .map(function (p) {
                    return { id: p.id, name: String(p.name).slice(0, 40), state: normalize(p.state) };
                });
            saveUserPresets();
        }
        if (raw.background && raw.background.dataUrl) {
            return dbPut('bg-' + Date.now().toString(36), raw.background.dataUrl).then(function (id) {
                next.background.type = 'image';
                next.background.imageId = id;
                runtimeImageUrl = raw.background.dataUrl;
                next.background.url = '';
                state = next;
                changed();
                return true;
            });
        }
        state = next;
        runtimeImageUrl = '';
        if (state.background.imageId) loadStoredImage(state.background.imageId);
        changed();
        return Promise.resolve(true);
    }

    if (window.AudioContext || window.webkitAudioContext) {
        document.addEventListener('pointerdown', function () {
            if (state.sound.enabled) audio();
        }, { passive: true });
    }

    // A phone and a desktop may need different background images.
    if (window.matchMedia) {
        var bgMq = window.matchMedia('(max-width: 640px)');
        var bgMqHandler = function () { applyBackground(); };
        if (bgMq.addEventListener) bgMq.addEventListener('change', bgMqHandler);
        else if (bgMq.addListener) bgMq.addListener(bgMqHandler);
    }

    window.toggleTheme = function () {
        applyPreset(state.mode === 'dark' ? 'light' : 'dark');
        play('switch');
        try { if (typeof window.renderTabs === 'function') window.renderTabs(); } catch (e) {}
    };
    window.applyTheme = function (mode) {
        applyPreset(mode === 'light' ? 'light' : 'dark');
        try { if (typeof window.renderTabs === 'function') window.renderTabs(); } catch (e) {}
    };

    window.NKSETheme = {
        get state() { return state; },
        getState: function () { return state; },
        getColors: function () { return COLOR_LIST; },
        getPresets: getPresets,
        getPresetColors: getPresetColors,
        getSoundPacks: function () { return Object.keys(SOUND_PACKS); },
        apply: apply,
        applyPreset: applyPreset,
        savePreset: savePreset,
        deletePreset: deletePreset,
        exportPresetCode: exportPresetCode,
        importPresetCode: importPresetCode,
        setColor: setColor,
        setMetric: setMetric,
        setBackground: setBackground,
        setBackgroundImage: setBackgroundImage,
        processImageFile: processImageFile,
        setSound: setSound,
        play: play,
        previewSound: previewSound,
        resetColors: resetColors,
        resetMetrics: resetMetrics,
        resetBackground: resetBackground,
        exportState: exportState,
        importState: importState,
        resetAll: resetAll
    };

    // Apply immediately, while the document is still parsing the head.
    apply();
    if (state.background.imageId) loadStoredImage(state.background.imageId);
})();
