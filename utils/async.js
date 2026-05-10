async function delay(ms) {
    await new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`Timeout:${label}`)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(t);
    }
}

module.exports = { delay, withTimeout };
