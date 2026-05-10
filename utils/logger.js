function ts() {
    return new Date().toISOString();
}

const buckets = new Map();

function isCommonDiscordError(err) {
    const code = Number(err?.code ?? err?.rawError?.code ?? NaN);
    if (!Number.isFinite(code)) return false;
    return code === 10003 || code === 10008 || code === 50001 || code === 50013 || code === 50035;
}

function errKey(err) {
    const code = String(err?.code ?? err?.rawError?.code ?? err?.name ?? '');
    const msg = String(err?.message ?? err ?? '').slice(0, 180);
    return `${code}:${msg}`;
}

function logErrorDedupe(prefix, msg, err) {
    const windowMs = 60000;
    const key = `${prefix}:${msg}:${errKey(err)}`;
    const now = Date.now();
    const prev = buckets.get(key) ?? { lastAt: 0, suppressed: 0 };
    if (now - prev.lastAt < windowMs) {
        prev.suppressed++;
        buckets.set(key, prev);
        return;
    }
    const suppressed = prev.suppressed;
    prev.lastAt = now;
    prev.suppressed = 0;
    buckets.set(key, prev);

    console.error(`[${ts()}] ERROR ${msg}${suppressed ? ` (suprimido ${suppressed})` : ''}`);
    if (!err) return;
    if (isCommonDiscordError(err)) {
        const code = String(err?.code ?? err?.rawError?.code ?? '');
        const status = String(err?.status ?? '');
        const emsg = String(err?.message ?? err ?? '');
        console.error(`${code ? `code=${code} ` : ''}${status ? `status=${status} ` : ''}${emsg}`.trim());
        return;
    }
    console.error(err);
}

function info(msg) {
    console.log(`[${ts()}] INFO  ${msg}`);
}

function warn(msg) {
    console.warn(`[${ts()}] WARN  ${msg}`);
}

function error(msg, err) {
    logErrorDedupe('utils.logger', msg, err);
}

module.exports = { info, warn, error };
