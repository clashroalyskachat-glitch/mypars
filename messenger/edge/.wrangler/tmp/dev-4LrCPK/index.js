var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
function b64url(value) {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - value.length % 4);
  const base64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
__name(b64url, "b64url");
async function validateToken(token, env) {
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.sub) return null;
  if (payload.exp && payload.exp * 1e3 < Date.now()) return null;
  try {
    const response = await fetch(
      env.SUPABASE_URL + "/rest/v1/profiles?select=id&limit=1",
      {
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + token
        },
        signal: AbortSignal.timeout(5e3)
      }
    );
    if (response.status !== 200 && response.status !== 206) return null;
    await response.text();
  } catch (e) {
    return null;
  }
  return payload;
}
__name(validateToken, "validateToken");
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (url.pathname === "/") {
      return new Response("pps relay ok", { status: 200, headers: cors });
    }
    if (url.pathname !== "/ws") {
      return new Response("not found", { status: 404, headers: cors });
    }
    const token = url.searchParams.get("token") || "";
    const peer = url.searchParams.get("peer") || "";
    const payload = await validateToken(token, env);
    if (!payload || !peer || peer === payload.sub) {
      return new Response("unauthorized", { status: 401 });
    }
    const pair = [payload.sub, peer].sort().join(":");
    const id = env.CHAT_ROOM.idFromName(pair);
    const stub = env.CHAT_ROOM.get(id);
    const headers = new Headers(request.headers);
    headers.set("X-Uid", payload.sub);
    headers.set("X-Nick", encodeURIComponent(payload.nick || ""));
    headers.set("X-Pair", pair);
    return stub.fetch(new Request("https://relay/room", { headers }));
  }
};
var ChatRoom = class {
  static {
    __name(this, "ChatRoom");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const uid = request.headers.get("X-Uid") || "";
    const nick = decodeURIComponent(request.headers.get("X-Nick") || "");
    const pair = request.headers.get("X-Pair") || "";
    if (!uid) return new Response("unauthorized", { status: 401 });
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ uid, nick, pair, rate: { at: Date.now(), count: 0 } });
    try {
      server.send(JSON.stringify({ type: "ready" }));
    } catch (e) {
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    const meta = ws.deserializeAttachment();
    if (!meta || !meta.uid) return;
    const now = Date.now();
    let rate = meta.rate || { at: now, count: 0 };
    if (now - rate.at > 1e4) rate = { at: now, count: 0 };
    rate.count += 1;
    ws.serializeAttachment({ ...meta, rate });
    if (rate.count > 60) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!data || !data.clientId) return;
    const clientId = String(data.clientId).slice(0, 80);
    if (data.type === "msg") {
      const body = String(data.body || "").slice(0, 8e3);
      if (!body) return;
      this.broadcast(JSON.stringify({
        type: "msg",
        fromUid: meta.uid,
        fromNick: meta.nick,
        clientId,
        body,
        createdAt: data.createdAt || (/* @__PURE__ */ new Date()).toISOString()
      }));
    } else if (data.type === "failed") {
      this.broadcast(JSON.stringify({
        type: "failed",
        fromUid: meta.uid,
        clientId
      }));
    }
  }
  broadcast(payload) {
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(payload);
      } catch (e) {
      }
    }
  }
  async webSocketClose(ws) {
    try {
      ws.close();
    } catch (e) {
    }
  }
  async webSocketError(ws) {
    try {
      ws.close();
    } catch (e) {
    }
  }
};

// ../../../../AppData/Local/npm-cache/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../AppData/Local/npm-cache/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-9xG1ZC/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../AppData/Local/npm-cache/_npx/d77349f55c2be1c0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-9xG1ZC/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ChatRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
