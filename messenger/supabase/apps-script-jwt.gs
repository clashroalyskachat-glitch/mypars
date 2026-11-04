/*
 * Supabase JWT bridge for the existing Google Apps Script auth.
 *
 * Paste these functions into the Apps Script project that already serves
 * library/backend/Code.gs. Then add a Script Property:
 *
 *   SUPABASE_JWT_SECRET = <Project Settings -> API -> JWT Settings -> JWT Secret>
 *
 * Never put this secret into the browser or into the repository.
 *
 * The messenger calls:
 *   POST { board: "auth", op: "supabase", token: "<nkse-session token>" }
 * and receives:
 *   { ok: true, token: "<supabase jwt>", user: { nick, role } }
 */

function supabaseJwt_(user) {
    var secret = PropertiesService.getScriptProperties().getProperty('SUPABASE_JWT_SECRET');
    if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set');

    var now = Math.floor(Date.now() / 1000);
    var header = b64url_(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    var payload = b64url_(JSON.stringify({
        sub: String(user.uid),
        role: 'authenticated',
        aud: 'authenticated',
        nick: String(user.nick),
        iat: now - 60,
        exp: now + 12 * 60 * 60,
    }));

    var unsigned = header + '.' + payload;
    var signature = Utilities.computeHmacSha256Signature(unsigned, secret);
    return unsigned + '.' + b64url_(signature);
}

function b64url_(value) {
    var encoded = typeof value === 'string'
        ? Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8)
        : Utilities.base64EncodeWebSafe(value);
    return String(encoded).replace(/=+$/, '');
}

/*
 * Add this branch inside authDispatch_ before the register/login check:
 *
 *   if (op === 'supabase') {
 *       var session = authSession_(data.token);
 *       if (!session) return { ok: false, error: 'no_session' };
 *       return {
 *           ok: true,
 *           token: supabaseJwt_({ uid: session.uid, nick: session.nick }),
 *           user: { nick: session.nick, role: session.role }
 *       };
 *   }
 */
