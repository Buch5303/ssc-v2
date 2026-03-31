'use strict';

function parse(str) {
    if (!str) return {};
    try { return JSON.parse(str); } catch { return {}; }
}

function stringify(obj) {
    try { return JSON.stringify(obj || {}); } catch { return '{}'; }
}

module.exports = { parse, stringify };
