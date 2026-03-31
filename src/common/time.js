'use strict';

function now() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

module.exports = { now };
