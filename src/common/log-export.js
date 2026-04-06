'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Day 35: Log Export — NDJSON file target for log shipping
 *
 * Writes structured JSON logs to a file in append mode.
 * Compatible with Fluentd, Filebeat, Vector, Loki.
 * Falls back to stdout if file path not configured.
 */

let _stream = null;
let _path = null;

function configure(opts = {}) {
    const logPath = opts.path || process.env.LOG_EXPORT_PATH || null;
    if (logPath && logPath !== _path) {
        if (_stream) _stream.end();
        const dir = path.dirname(logPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        _stream = fs.createWriteStream(logPath, { flags: 'a' });
        _path = logPath;
    }
}

function write(entry) {
    const line = JSON.stringify(entry) + '\n';
    if (_stream) {
        _stream.write(line);
    }
    // Always return the line for chaining
    return line;
}

function flush() {
    if (_stream) {
        return new Promise((resolve) => _stream.once('drain', resolve));
    }
    return Promise.resolve();
}

function close() {
    if (_stream) { _stream.end(); _stream = null; _path = null; }
}

function getPath() { return _path; }

module.exports = { configure, write, flush, close, getPath };
