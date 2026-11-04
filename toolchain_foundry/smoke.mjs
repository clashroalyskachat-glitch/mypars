/*
 * Smoke test for the built die (dist/).
 *
 * Runs in CI between `npm run build` and the Pages upload. If anything here
 * fails, the deploy step is skipped and the previous working site stays live.
 *
 * Checks:
 *   1. shell exists and references exactly one hashed css + one boot + one kernel
 *   2. every referenced bundle really exists in dist/
 *   3. schedule.json parses and is not empty
 *   4. manifest.dag.json hashes match the bytes on disk
 *   5. the service worker precaches exactly the files that exist
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const errors = [];
const check = (ok, message) => {
    if (!ok) errors.push(message);
};

const read = (rel) => fs.readFileSync(path.join(DIST, rel));
const exists = (rel) => fs.existsSync(path.join(DIST, rel));

/* 1-2. shell wiring ------------------------------------------------------- */
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const cssMatches = [...html.matchAll(/<link[^>]+href="(style\.[0-9a-f]{8}\.css)"/g)].map((m) => m[1]);
const bootMatches = [...html.matchAll(/<script[^>]+src="(boot\.[0-9a-f]{8}\.js)"/g)].map((m) => m[1]);
const kernelMatches = [...html.matchAll(/<script[^>]+src="(kernel\.[0-9a-f]{8}\.js)"/g)].map((m) => m[1]);

check(cssMatches.length === 1, `expected 1 hashed stylesheet, found ${cssMatches.length}`);
check(bootMatches.length === 1, `expected 1 boot bundle, found ${bootMatches.length}`);
check(kernelMatches.length === 1, `expected 1 kernel bundle, found ${kernelMatches.length}`);
check(!/src="(?:app|theme|settings|motion)\.js"/.test(html), 'shell still references unbundled scripts');
check(!/href="(?:app|theme|motion)\.css"/.test(html), 'shell still references unbundled stylesheets');

for (const rel of [...cssMatches, ...bootMatches, ...kernelMatches]) {
    check(exists(rel), `missing bundle referenced by shell: ${rel}`);
}

/* 3. data ---------------------------------------------------------------- */
check(exists('schedule.json'), 'dist/schedule.json missing');
if (exists('schedule.json')) {
    try {
        const data = JSON.parse(read('schedule.json').toString('utf8'));
        const groups = Object.keys(data);
        check(groups.length > 10, `schedule.json has only ${groups.length} groups`);
    } catch (err) {
        errors.push('schedule.json is not valid JSON: ' + err.message);
    }
}

/* 4. content-addressed manifest ------------------------------------------ */
const dagPath = path.join(DIST, 'manifest.dag.json');
check(fs.existsSync(dagPath), 'manifest.dag.json missing');
if (fs.existsSync(dagPath)) {
    const dag = JSON.parse(fs.readFileSync(dagPath, 'utf8'));
    for (const [rel, expected] of Object.entries(dag.files || {})) {
        if (!exists(rel)) {
            errors.push(`manifest lists missing file: ${rel}`);
            continue;
        }
        const actual = crypto.createHash('sha256').update(read(rel)).digest('hex').slice(0, 8);
        check(actual === expected, `hash mismatch for ${rel}: ${actual} != ${expected}`);
    }
}

/* 5. service worker precache --------------------------------------------- */
const sw = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
const precacheMatch = sw.match(/const PRECACHE = (\[[\s\S]*?\]);/);
check(!!precacheMatch, 'sw.js has no PRECACHE list');
if (precacheMatch) {
    const list = JSON.parse(precacheMatch[1]);
    check(list.length > 0, 'PRECACHE is empty');
    for (const rel of list) {
        if (rel === './') continue;
        check(exists(rel), `PRECACHE lists missing file: ${rel}`);
    }
    check(list.includes('index.html'), 'PRECACHE does not include index.html');
}

/* report ------------------------------------------------------------------ */
if (errors.length) {
    console.error('smoke test failed:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
}

console.log('smoke test passed: shell wired, ' + (cssMatches[0] + ' + ' + bootMatches[0] + ' + ' + kernelMatches[0]));
