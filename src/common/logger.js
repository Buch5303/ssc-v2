'use strict';
const logExport = require('./log-export');

/**
 * Day 28: Structured Logger
 *
 * JSON-structured logging with severity levels, correlation IDs,
 * and consistent field format. Replaces all console.log usage
 * in production paths.
 */

const LOG_LEVELS = Object.freeze({ ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 });
const LEVEL_NAMES = Object.freeze({ 0: 'ERROR', 1: 'WARN', 2: 'INFO', 3: 'DEBUG' });

let _level = LOG_LEVELS.INFO;
let _output = (entry) => console.log(JSON.stringify(entry));
let _silent = false;

function configure(opts = {}) {
    if (opts.level !== undefined && LOG_LEVELS[opts.level] !== undefined) _level = LOG_LEVELS[opts.level];
    if (typeof opts.output === 'function') _output = opts.output;
    if (opts.silent !== undefined) _silent = !!opts.silent;
}

function _emit(level, component, message, data) {
    if (_silent || level > _level) return;
    const entry = {
        ts: new Date().toISOString(),
        level: LEVEL_NAMES[level],
        component,
        msg: message,
    };
    if (data && typeof data === 'object') {
        if (data.org_id) entry.org_id = data.org_id;
        if (data.user_id) entry.user_id = data.user_id;
        if (data.request_id) entry.request_id = data.request_id;
        if (data.correlation_id) entry.correlation_id = data.correlation_id;
        entry.data = data;
    }
    _output(entry);
    logExport.write(entry);
}

function error(component, msg, data) { _emit(LOG_LEVELS.ERROR, component, msg, data); }
function warn(component, msg, data)  { _emit(LOG_LEVELS.WARN, component, msg, data); }
function info(component, msg, data)  { _emit(LOG_LEVELS.INFO, component, msg, data); }
function debug(component, msg, data) { _emit(LOG_LEVELS.DEBUG, component, msg, data); }

// Request-scoped logger factory
function forRequest(req) {
    const ctx = {
        request_id: req.headers && req.headers['x-request-id'] || _generateId(),
        org_id: req.identity && req.identity.orgId || null,
        user_id: req.identity && req.identity.userId || null,
    };
    return {
        error: (component, msg, data) => _emit(LOG_LEVELS.ERROR, component, msg, { ...ctx, ...data }),
        warn:  (component, msg, data) => _emit(LOG_LEVELS.WARN, component, msg, { ...ctx, ...data }),
        info:  (component, msg, data) => _emit(LOG_LEVELS.INFO, component, msg, { ...ctx, ...data }),
        debug: (component, msg, data) => _emit(LOG_LEVELS.DEBUG, component, msg, { ...ctx, ...data }),
        ctx,
    };
}

let _idCounter = 0;
function _generateId() { return 'req-' + Date.now() + '-' + (++_idCounter); }

module.exports = { configure, error, warn, info, debug, forRequest, LOG_LEVELS, LEVEL_NAMES };
