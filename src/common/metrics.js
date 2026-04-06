'use strict';

/**
 * Day 29: Observability — Metrics Collector
 *
 * Lightweight metrics for latency, errors, approvals, rejections.
 * In-memory for sql.js mode. Pluggable backend for production.
 *
 * Tracks:
 * - Counters: requests, approvals, rejections, errors, rate_limits
 * - Histograms: latency_ms per operation
 * - Gauges: queue_depth, pending_approvals
 */

const _counters = {};
const _histograms = {};
const _gauges = {};
let _alertHooks = [];

function increment(name, tags = {}) {
    const key = _key(name, tags);
    _counters[key] = (_counters[key] || 0) + 1;
}

function recordLatency(name, ms, tags = {}) {
    const key = _key(name, tags);
    if (!_histograms[key]) _histograms[key] = { count: 0, sum: 0, min: Infinity, max: 0, p95: [] };
    const h = _histograms[key];
    h.count++;
    h.sum += ms;
    if (ms < h.min) h.min = ms;
    if (ms > h.max) h.max = ms;
    h.p95.push(ms);
    if (h.p95.length > 1000) h.p95.shift(); // rolling window
}

function setGauge(name, value, tags = {}) {
    _gauges[_key(name, tags)] = value;
}

function getCounter(name, tags = {}) { return _counters[_key(name, tags)] || 0; }
function getGauge(name, tags = {}) { return _gauges[_key(name, tags)] || 0; }

function getHistogram(name, tags = {}) {
    const h = _histograms[_key(name, tags)];
    if (!h) return null;
    const sorted = [...h.p95].sort((a, b) => a - b);
    return {
        count: h.count,
        avg_ms: h.count > 0 ? Math.round(h.sum / h.count) : 0,
        min_ms: h.min === Infinity ? 0 : h.min,
        max_ms: h.max,
        p95_ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0,
    };
}

function snapshot() {
    return {
        counters: { ..._counters },
        gauges: { ..._gauges },
        histograms: Object.fromEntries(
            Object.entries(_histograms).map(([k, v]) => {
                const sorted = [...v.p95].sort((a, b) => a - b);
                return [k, { count: v.count, avg: v.count > 0 ? Math.round(v.sum / v.count) : 0,
                    min: v.min === Infinity ? 0 : v.min, max: v.max,
                    p95: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0 }];
            })
        ),
        timestamp: new Date().toISOString(),
    };
}

// Alerting hooks
function onAlert(fn) { if (typeof fn === 'function') _alertHooks.push(fn); }

function checkAlert(name, value, threshold) {
    if (value > threshold) {
        const alert = { name, value, threshold, timestamp: new Date().toISOString() };
        _alertHooks.forEach(fn => { try { fn(alert); } catch { /* */ } });
        return alert;
    }
    return null;
}

// Timer utility
function startTimer() {
    const start = process.hrtime.bigint ? process.hrtime.bigint() : Date.now();
    return {
        end(name, tags) {
            const elapsed = process.hrtime.bigint
                ? Number(process.hrtime.bigint() - start) / 1e6
                : Date.now() - start;
            recordLatency(name, Math.round(elapsed), tags);
            return Math.round(elapsed);
        }
    };
}

// Health probe data
function healthProbe(db) {
    const probe = {
        status: 'healthy',
        uptime_s: Math.floor(process.uptime()),
        metrics: {
            total_requests: getCounter('requests.total'),
            total_errors: getCounter('errors.total'),
            approvals: getCounter('approvals.total'),
            rejections: getCounter('rejections.total'),
        },
        timestamp: new Date().toISOString(),
    };

    try {
        if (db && typeof db.prepare === 'function') {
            const pending = db.prepare("SELECT COUNT(*) as c FROM approval_requests WHERE request_status = 'PENDING'").get();
            probe.metrics.pending_approvals = pending ? pending.c : 0;
        }
    } catch { probe.db_status = 'error'; }

    return probe;
}

function reset() {
    Object.keys(_counters).forEach(k => delete _counters[k]);
    Object.keys(_histograms).forEach(k => delete _histograms[k]);
    Object.keys(_gauges).forEach(k => delete _gauges[k]);
    _alertHooks = [];
}

function _key(name, tags) {
    const tagStr = Object.entries(tags).sort().map(([k, v]) => k + '=' + v).join(',');
    return tagStr ? name + '{' + tagStr + '}' : name;
}

module.exports = {
    increment, recordLatency, setGauge,
    getCounter, getGauge, getHistogram,
    snapshot, startTimer, healthProbe,
    onAlert, checkAlert, reset,
};
