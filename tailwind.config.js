/** Build-time Tailwind config (mirrors the old inline tailwind.config in index.html). */
module.exports = {
    darkMode: 'class',
    content: ['./index.html', './app.js'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
            },
            colors: {
                darkbg: '#0B0F19',
                cardbg: '#121826',
            },
        },
    },
    corePlugins: {
        // The page never uses these; dropping them shrinks the output.
        container: false,
    },
};