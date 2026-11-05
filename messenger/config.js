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
    window.PPS_AUTH_API = 'https://script.google.com/macros/s/AKfycbyLgfwIeyM6irptQU_4I3giVfX2AO0wPCnkGtMRa_GrKBHGdUu9n23u0YEnOA7WtG1z/exec';

    /* Public Firebase config. The VAPID key is public by design. */
    window.PPS_FIREBASE = {
        apiKey: 'AIzaSyAjRgRf0_tJu5LpsGBWecGYxvh3w2aPZvk',
        authDomain: 'nkselove.firebaseapp.com',
        projectId: 'nkselove',
        storageBucket: 'nkselove.firebasestorage.app',
        messagingSenderId: '520052696233',
        appId: '1:520052696233:web:1ab56a3e2206b3f58e35b8',
        vapidKey: 'BAlNtff24onUrNUL_8_w9OSFuvNIwIMxpPF5dL-nlQo7-0QDQyPkPE0uUfLyMW5jYENQUzNL0kcvaTBBowJn0ZU',
    };
})();
