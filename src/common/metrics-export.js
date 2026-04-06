'use strict';
const metrics = require('./metrics');

/**
 * Day 35: Prometheus/OpenTelemetry-compatible metrics export
 *
 * Exports metrics.snapshot() in Prometheus exposition format.
 * Mount at /metrics for Prometheus scraping.
 */

function toPrometheus() {
    const snap = metrics.snapshot();
    const lines = [];
    const ts = Date.now();

    // Counters
    for (const [name, value] of Object.entries(snap.counters || {})) {
        const safeName = _sanitize(name);
        lines.push('# TYPE ' + safeName + ' counter');
        lines.push(safeName + ' ' + value + ' ' + ts);
    }

    // Gauges
    for (const [name, value] of Object.entries(snap.gauges || {})) {
        const safeName = _sanitize(name);
        lines.push('# TYPE ' + safeName + ' gauge');
        lines.push(safeName + ' ' + value + ' ' + ts);
    }

    // Histograms (summary-style)
    for (const [name, h] of Object.entries(snap.histograms || {})) {
        const safeName = _sanitize(name);
        lines.push('# TYPE ' + safeName + ' summary');
        lines.push(safeName + '_count ' + (h.count || 0) + ' ' + ts);
        lines.push(safeName + '_sum ' + ((h.avg || 0) * (h.count || 0)) + ' ' + ts);
        lines.push(safeName + '{quantile="0.5"} ' + (h.avg || 0) + ' ' + ts);
        lines.push(safeName + '{quantile="0.95"} ' + (h.p95 || 0) + ' ' + ts);
        lines.push(safeName + '{quantile="1.0"} ' + (h.max || 0) + ' ' + ts);
    }

    return lines.join('\n') + '\n';
}

function toJSON() { return metrics.snapshot(); }

function _sanitize(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
}

// Express middleware
function metricsEndpoint(req, res) {
    const accept = req.headers['accept'] || '';
    if (accept.includes('application/json')) {
        res.json(toJSON());
    } else {
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(toPrometheus());
    }
}

module.exports = { toPrometheus, toJSON, metricsEndpoint };
