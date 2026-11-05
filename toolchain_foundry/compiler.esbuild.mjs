/*
 * NKSE Kernel Foundry — build pipeline.
 *
 * Silicon-Grade Static Compilation, stage 1.
 *
 * Input:  src/ (rings, css layers, html shell)
 * Output: dist/ — exactly two cached bundles + shell:
 *           boot.<hash>.js    Ring 0: theme bootstrap, must run before paint
 *           kernel.<hash>.js  Rings 2-3: schedule engine, settings, motion
 *           style.<hash>.css  flattened cascade of the css layers
 *           sw.js             deterministic service worker with a hash manifest
 *           manifest.dag.json content hashes of every emitted asset
 *
 * Every bundle name carries a content hash, so the service worker can treat it
 * as immutable and the browser can cache it forever.
 */

import { transform } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/* ---------------------------------------------------------------- rings --- */

const RING0 = ['ring2_compute_units/unit_theme_pipeline/theme.js'];

const RING2_3 = [
    'ring2_compute_units/unit_schedule_engine/app.js',
    'ring3_viewport_ui/composites/settings.js',
    'ring2_compute_units/unit_motion_physics/motion.js',
    // Inline HTML handlers (onclick="clearOfflineCache()") need real globals;
    // this bridge keeps the contract explicit instead of relying on minifier luck.
    'ring2_compute_units/unit_schedule_engine/exports.bridge.js',
];

const CSS_LAYERS = [
    'css_architecture/00_fonts.css',
    'css_architecture/00_structural.css',
    'css_architecture/01_semantic_theme.css',
    'css_architecture/02_motion.css',
];

/* --------------------------------------------------------------- helpers --- */

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

async function emit(rel, contents) {
    const file = path.join(DIST, rel);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, contents);
    return { rel, size: Buffer.byteLength(contents) };
}

async function copy(rel) {
    const from = path.join(ROOT, rel);
    if (!fs.existsSync(from)) return null;
    await fsp.mkdir(path.dirname(path.join(DIST, rel)), { recursive: true });
    await fsp.cp(from, path.join(DIST, rel), { recursive: true });
    return rel;
}

/* ----------------------------------------------------------------- build --- */

async function main() {
    await fsp.rm(DIST, { recursive: true, force: true });
    await fsp.mkdir(DIST, { recursive: true });

    const report = [];

    /* --- Ring 0: boot ROM (theme, runs in <head>, blocking, tiny) --- */
    const bootSrc = RING0.map(read).join('\n;\n');
    const boot = await transform(bootSrc, { loader: 'js', minify: true, target: 'es2019' });
    const bootHash = hash(boot.code);
    const bootName = `boot.${bootHash}.js`;
    report.push(await emit(bootName, boot.code));

    /* --- Rings 2-3: the compute kernel --- */
    const kernelSrc = RING2_3.map(read).join('\n;\n');
    const kernel = await transform(kernelSrc, { loader: 'js', minify: true, target: 'es2019' });
    const kernelHash = hash(kernel.code);
    const kernelName = `kernel.${kernelHash}.js`;
    report.push(await emit(kernelName, kernel.code));

    /* --- CSS: one flattened cascade, order = layer order --- */
    const cssSrc = CSS_LAYERS.map(read).join('\n');
    const css = await transform(cssSrc, { loader: 'css', minify: true, target: 'es2019' });
    const cssHash = hash(css.code);
    const styleName = `style.${cssHash}.css`;
    report.push(await emit(styleName, css.code));

    /* --- HTML shell: swap 3 css + 4 js for 1 + 1 --- */
    let html = await fsp.readFile(path.join(SRC, 'index.html'), 'utf8');
    html = html
        // three stylesheets, two of them far from the first -> replace each tag
        .replace(
            /[ \t]*<link rel="stylesheet" href="app\.css">/,
            `    <link rel="stylesheet" href="${styleName}">`
        )
        .replace(/[ \t]*<link rel="stylesheet" href="theme\.css">[ \t]*\r?\n/, '')
        .replace(/[ \t]*<link rel="stylesheet" href="motion\.css">[ \t]*\r?\n/, '')
        // boot runs in <head> before paint; the rest is one deferred kernel
        .replace(
            /[ \t]*<script src="theme\.js"><\/script>/,
            `    <script src="${bootName}"></script>`
        )
        .replace(/[ \t]*<script src="app\.js"><\/script>[ \t]*\r?\n/, '')
        .replace(/[ \t]*<script src="settings\.js"><\/script>[ \t]*\r?\n/, '')
        .replace(
            /[ \t]*<script src="motion\.js"><\/script>/,
            `<script src="${kernelName}"></script>`
        );

    if (/href="(?:app|theme|motion)\.css"/.test(html) || /src="(?:app|theme|settings|motion)\.js"/.test(html)) {
        throw new Error('HTML shell rewrite failed: old asset tags still present');
    }
    report.push(await emit('index.html', html));

    /* --- static shell assets --- */
    for (const rel of [
        'schedule.json',
        'manifest.json',
        'icon.svg',
        '.nojekyll',
        'assets',
        'library',
        'wishes',
        'messenger',
    ]) {
        await copy(rel);
    }

    /* messenger: в прод не едут dev-скрипты и SQL-схема Supabase */
    for (const rel of [
        'messenger/dev-server.mjs',
        'messenger/dev-smoke.mjs',
        'messenger/README.md',
        'messenger/UX_RESEARCH.md',
    ]) {
        await fsp.rm(path.join(DIST, rel), { force: true });
    }
    await fsp.rm(path.join(DIST, 'messenger', 'supabase'), { recursive: true, force: true });

    /* --- service worker: manifest is baked in at build time --- */
    const precache = [
        './',
        'index.html',
        styleName,
        bootName,
        kernelName,
        'manifest.json',
        'icon.svg',
    ];
    const version = hash(
        precache.join('|') +
        kernelHash +
        cssHash +
        ['app.js', 'config.js', 'styles.css', 'index.html']
            .map((file) => hash(fs.readFileSync(path.join(ROOT, 'messenger', file))))
            .join('')
    );
    const swTemplate = await fsp.readFile(path.join(SRC, 'sw.template.js'), 'utf8');
    const sw = swTemplate
        .replace('__VERSION__', `nkse-${version}`)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 4));
    report.push(await emit('sw.js', sw));

    /* --- content-addressable manifest (Merkle leaf list) --- */
    const dag = {
        build: version,
        bundles: {
            boot: bootName,
            kernel: kernelName,
            style: styleName,
            serviceWorker: 'sw.js',
        },
        files: {},
    };
    for (const item of report) {
        const buf = await fsp.readFile(path.join(DIST, item.rel));
        dag.files[item.rel] = hash(buf);
    }
    await emit('manifest.dag.json', JSON.stringify(dag, null, 2));

    /* --- report --- */
    const totalBundle = boot.code.length + kernel.code.length + css.code.length;
    console.log('kernel foundry — build ' + version);
    for (const item of report) {
        console.log('  ' + item.rel.padEnd(24) + kb(item.size));
    }
    console.log('  bundles total           ' + kb(totalBundle));
    console.log('  html                    ' + kb(html.length));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
