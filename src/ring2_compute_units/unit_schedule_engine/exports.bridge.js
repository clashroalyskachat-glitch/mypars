/*
 * Ring 2 -> HTML bridge.
 *
 * The shell still uses a couple of inline handlers (onclick="clearOfflineCache()").
 * Minification renames top-level bindings, so every name the HTML can reach must
 * be published deliberately. This file is the complete, auditable list.
 */

window.clearOfflineCache = clearOfflineCache;
