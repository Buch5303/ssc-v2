'use strict';
const logger = require('../common/logger');
let Redis;
try { Redis = require('ioredis'); } catch { Redis = null; }

let _client = null;

function getClient() {
    if (_client) return _client;
    if (!Redis) { logger.warn('redis-client', 'ioredis not available'); return null; }
    const url = process.env.REDIS_URL || null;
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT, 10) || 6379;
    _client = url ? new Redis(url) : new Redis({ host, port, maxRetriesPerRequest: 3, retryStrategy: (times) => Math.min(times * 200, 3000) });
    _client.on('error', (err) => logger.error('redis-client', 'connection error', { error: err.message }));
    _client.on('connect', () => logger.info('redis-client', 'connected', { host, port }));
    return _client;
}

async function healthCheck() {
    try {
        const client = getClient();
        if (!client) return { healthy: false, error: 'redis not configured' };
        const pong = await client.ping();
        return { healthy: pong === 'PONG' };
    } catch (err) { return { healthy: false, error: err.message }; }
}

async function close() { if (_client) { _client.disconnect(); _client = null; } }

module.exports = { getClient, healthCheck, close };
