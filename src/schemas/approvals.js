'use strict';
const { V } = require('../common/validate');

const approve   = { reason: V.optString(1000), metadata: V.optObject(100) };
const reject    = { reason: V.optString(1000), metadata: V.optObject(100) };
const cancel    = { reason: V.optString(1000), metadata: V.optObject(100) };
const listQuery = {
    status:      V.optEnumOf(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
    target_type: V.optString(100),
    action_key:  V.optString(200),
    risk_level:  V.optEnumOf(['LOW', 'MEDIUM', 'HIGH']),
    limit:       V.optPosInt(),
    offset:      V.optPosInt(),
};

module.exports = { approve, reject, cancel, listQuery };
