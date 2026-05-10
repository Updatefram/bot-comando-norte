function ts() {
    return new Date().toISOString();
}

function info(msg) {
    console.log(`[${ts()}] INFO  ${msg}`);
}

function warn(msg) {
    console.warn(`[${ts()}] WARN  ${msg}`);
}

function error(msg, err) {
    console.error(`[${ts()}] ERROR ${msg}`);
    if (err) console.error(err);
}

module.exports = { info, warn, error };
