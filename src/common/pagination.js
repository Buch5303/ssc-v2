'use strict';

function clampInt(val, min, max, fallback) {
    const n = parseInt(val, 10);
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function fromQuery(query) {
    return {
        limit:  clampInt(query.limit, 1, 200, 50),
        offset: clampInt(query.offset, 0, Number.MAX_SAFE_INTEGER, 0),
    };
}

module.exports = { clampInt, fromQuery };
