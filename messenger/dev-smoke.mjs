/*
 * Dev smoke test for messenger/dev-server.mjs.
 * Run the dev server first, then:
 *   node messenger/dev-smoke.mjs
 */

const URL = process.env.PPS_WS || 'ws://127.0.0.1:8091/ws';

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        const queue = [];
        const waiters = [];
        const timer = setTimeout(() => reject(new Error('connect timeout')), 5000);

        ws.addEventListener('open', () => {
            clearTimeout(timer);
            resolve({
                ws,
                send(payload) { ws.send(JSON.stringify(payload)); },
                next(type, timeout = 5000) {
                    return new Promise((res, rej) => {
                        const found = queue.find((m) => m.type === type);
                        if (found) {
                            queue.splice(queue.indexOf(found), 1);
                            return res(found);
                        }
                        const t = setTimeout(() => rej(new Error('timeout waiting for ' + type)), timeout);
                        waiters.push({ type, res, rej, t });
                    });
                },
                close() { ws.close(); },
            });
        });
        ws.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            const waiter = waiters.find((w) => w.type === msg.type);
            if (waiter) {
                clearTimeout(waiter.t);
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.res(msg);
            } else {
                queue.push(msg);
            }
        });
        ws.addEventListener('error', () => reject(new Error('ws error')));
    });
}

const alice = await connect();
const bob = await connect();

alice.send({ type: 'register', nick: 'alice-' + Date.now().toString(36).slice(-4), password: 'secret123' });
const aliceAuth = await alice.next('auth');
if (!aliceAuth.ok) throw new Error('alice auth: ' + aliceAuth.error);

bob.send({ type: 'register', nick: 'bob-' + Date.now().toString(36).slice(-4), password: 'secret123' });
const bobAuth = await bob.next('auth');
if (!bobAuth.ok) throw new Error('bob auth: ' + bobAuth.error);

alice.send({ type: 'search', query: bobAuth.user.nick });
const search = await alice.next('search');
if (!search.users.some((u) => u.nick === bobAuth.user.nick && u.online)) {
    throw new Error('search did not find online bob');
}

alice.send({ type: 'message', to: bobAuth.user.nick, text: 'hello', id: 'm1' });
const delivered = await bob.next('message');
if (delivered.message.text !== 'hello') throw new Error('message mismatch');

alice.send({ type: 'signal', to: bobAuth.user.nick, data: { kind: 'offer', sdp: 'test' } });
const signal = await bob.next('signal');
if (signal.data.kind !== 'offer') throw new Error('signal mismatch');

alice.send({ type: 'history', with: bobAuth.user.nick });
const history = await alice.next('history');
if (!history.messages.some((m) => m.text === 'hello')) throw new Error('history missing message');

console.log('OK', {
    alice: aliceAuth.user.nick,
    bob: bobAuth.user.nick,
    search: search.users.length,
    message: delivered.message.text,
    signal: signal.data.kind,
    history: history.messages.length,
});

alice.close();
bob.close();
