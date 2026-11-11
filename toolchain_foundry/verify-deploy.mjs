const checks = [
    ['https://nkselove.web.app/mypars/', 'расписание'],
    ['https://nkselove.web.app/mypars/messenger/', 'мессенджер'],
];

let failed = false;

for (const [url, name] of checks) {
    try {
        const response = await fetch(url + '?verify=' + Date.now());
        const text = await response.text();
        const ok = response.ok && !/Page Not Found/i.test(text);
        console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${response.status} ${url}`);
        if (!ok) failed = true;
    } catch (error) {
        console.log(`FAIL ${name}: ${error.message} ${url}`);
        failed = true;
    }
}

if (failed) process.exit(1);
