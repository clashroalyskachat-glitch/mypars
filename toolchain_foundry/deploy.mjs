/*
 * Безопасный деплой:
 *   1. собрать firebase-dist и проверить обязательные файлы;
 *   2. выложить в preview-канал;
 *   3. проверить расписание и мессенджер на preview;
 *   4. только после успеха склонировать канал в live;
 *   5. проверить live.
 *
 * Если любой шаг падает, live остаётся прежним.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'nkselove';
const SITE = 'nkselove';
const channel = 'verify-' + Date.now();

const firebase = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true,
        env: process.env,
    });
    if (result.status !== 0) {
        console.error(result.stdout || '');
        console.error(result.stderr || '');
        throw new Error(`${command} ${args.join(' ')} завершился с кодом ${result.status}`);
    }
    return (result.stdout || '') + (result.stderr || '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(url, expected) {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const response = await fetch(url + '?verify=' + Date.now());
            const text = await response.text();
            const ok = response.ok && !/Page Not Found/i.test(text) && text.includes(expected);
            if (ok) {
                console.log(`OK  ${url} (${response.status})`);
                return true;
            }
            console.log(`... ${url}: ${response.status}, попытка ${attempt}`);
        } catch (error) {
            console.log(`... ${url}: ${error.message}, попытка ${attempt}`);
        }
        await sleep(2000);
    }
    console.log(`FAIL ${url}`);
    return false;
}

async function cleanup() {
    try {
        run(firebase, ['hosting:channel:delete', channel, '--project', PROJECT, '--force']);
    } catch (error) {
        console.log('cleanup: ' + error.message);
    }
}

async function main() {
    console.log('1/5 сборка и проверка firebase-dist');
    run(npm, ['run', 'build:firebase']);

    console.log('2/5 preview-канал ' + channel);
    const output = run(firebase, [
        'hosting:channel:deploy', channel,
        '--expires', '1d',
        '--project', PROJECT,
    ]).replace(/\x1b\[[0-9;]*m/g, '');
    const labelled = output.match(/Channel URL:\s*(https:\/\/[^\s]+)/i);
    const match = labelled || output.match(/https:\/\/[^\s]*--[^\s]*\.web\.app/);
    if (!match) throw new Error('CLI не вернул URL preview-канала');
    const preview = (labelled ? match[1] : match[0]).replace(/\/$/, '');
    console.log('preview: ' + preview);

    console.log('3/5 проверка preview');
    const previewOk =
        await check(preview + '/mypars/', 'Расписание') &&
        await check(preview + '/mypars/messenger/', 'мессенджер');
    if (!previewOk) throw new Error('preview не прошёл проверку — live не трогаем');

    console.log('4/5 публикация проверенной версии в live');
    run(firebase, [
        'hosting:clone',
        `${SITE}:${channel}`,
        `${SITE}:live`,
        '--project', PROJECT,
    ]);

    console.log('5/5 проверка live');
    const liveOk =
        await check(`https://${SITE}.web.app/mypars/`, 'Расписание') &&
        await check(`https://${SITE}.web.app/mypars/messenger/`, 'мессенджер');
    if (!liveOk) throw new Error('live не прошёл проверку после публикации');

    console.log('Готово: live обновлён только после успешной проверки.');
    process.exitCode = 0;
}

main()
    .catch((error) => {
        console.error('ДЕПЛОЙ ОСТАНОВЛЕН: ' + error.message);
        process.exitCode = 1;
    })
    .finally(cleanup);
