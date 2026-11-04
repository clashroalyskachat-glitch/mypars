/*
 * Public client configuration. Safe to commit: the Supabase publishable key
 * is designed for browsers. Never put the JWT secret or service_role key here.
 *
 * Local dev uses the in-memory WebSocket server. Append ?supabase=1 to test
 * the production backend from localhost.
 */
(function () {
    var forceSupabase = new URLSearchParams(location.search).has('supabase');
    var local = ['localhost', '127.0.0.1', '::1'].indexOf(location.hostname) !== -1;

    window.PPS_SUPABASE = (!local || forceSupabase) ? {
        url: 'https://ddlbctrydkaazyitipup.supabase.co',
        key: 'sb_publishable_ib6_aOSMcEZIQwlwuJjXog_2lgTXWDk',
    } : null;

    /* Existing college auth endpoint (same one used by the wishes board). */
    window.PPS_AUTH_API = 'https://script.google.com/macros/s/AKfycbxxCl5PY_PKIHwThoVSrfLvVP29jxgHhvxHjXTNXrnk-3g1nQrGm1ywZk8w5UWeWgkL/exec';
})();
