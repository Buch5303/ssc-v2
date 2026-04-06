'use strict';

const MAX_JSON_BYTES = 102400;

function _hasCtrl(s) {
    return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s);
}

const V = {
    string(maxLen = 1000)                      { return { type: 'string',  required: true,  maxLen }; },
    optString(maxLen = 1000)                   { return { type: 'string',  required: false, maxLen }; },
    enumOf(allowed)                            { return { type: 'enum',    required: true,  allowed: new Set(allowed) }; },
    optEnumOf(allowed)                         { return { type: 'enum',    required: false, allowed: new Set(allowed) }; },
    bool()                                     { return { type: 'bool',    required: true }; },
    optBool()                                  { return { type: 'bool',    required: false }; },
    posInt()                                   { return { type: 'posInt',  required: true }; },
    optPosInt()                                { return { type: 'posInt',  required: false }; },
    object(maxBytes = MAX_JSON_BYTES)          { return { type: 'object',  required: true,  maxBytes }; },
    optObject(maxBytes = MAX_JSON_BYTES)       { return { type: 'object',  required: false, maxBytes }; },
};

function validate(input, schema) {
    if (!input || typeof input !== 'object') input = {};
    const errors = [], cleaned = {};

    for (const [field, rule] of Object.entries(schema)) {
        const raw = input[field];
        const absent = raw === undefined || raw === null;

        if (absent) {
            if (rule.required) errors.push(field + ': required');
            else if (rule.type === 'bool') cleaned[field] = false;
            else if (rule.type === 'object') cleaned[field] = {};
            else cleaned[field] = null;
            continue;
        }

        switch (rule.type) {
            case 'string':
                if (typeof raw !== 'string') { errors.push(field + ': must be string'); break; }
                if (raw.length > rule.maxLen) { errors.push(field + ': exceeds ' + rule.maxLen + ' chars'); break; }
                if (_hasCtrl(raw)) { errors.push(field + ': contains control characters'); break; }
                cleaned[field] = raw; break;
            case 'enum': {
                const val = typeof raw === 'string' ? raw : String(raw);
                if (!rule.allowed.has(val)) { errors.push(field + ': must be one of [' + [...rule.allowed].join(', ') + ']'); break; }
                cleaned[field] = val; break;
            }
            case 'bool':
                if (typeof raw === 'boolean') { cleaned[field] = raw; break; }
                if (raw === 'true' || raw === '1') { cleaned[field] = true; break; }
                if (raw === 'false' || raw === '0') { cleaned[field] = false; break; }
                errors.push(field + ': must be boolean'); break;
            case 'posInt': {
                const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
                if (isNaN(n) || n < 1 || !Number.isInteger(n)) { errors.push(field + ': must be positive integer'); break; }
                cleaned[field] = n; break;
            }
            case 'object':
                if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(field + ': must be object'); break; }
                try { if (JSON.stringify(raw).length > rule.maxBytes) { errors.push(field + ': exceeds ' + rule.maxBytes + ' bytes'); break; } }
                catch { errors.push(field + ': not serializable'); break; }
                cleaned[field] = raw; break;
            default: errors.push(field + ': unknown validation type');
        }
    }
    return { valid: errors.length === 0, errors, cleaned };
}

function validateBody(schema) {
    return (req, res, next) => {
        const r = validate(req.body, schema);
        if (!r.valid) return res.status(400).json({ error: 'validation_failed', details: r.errors });
        req.validated = r.cleaned; next();
    };
}

module.exports = { validate, validateBody, V };
