'use strict';
const { V } = require('../common/validate');

const execute   = {
    action_type:      V.optString(100),
    is_bulk:          V.optBool(),
    is_ai_originated: V.optBool(),
    is_destructive:   V.optBool(),
    payload:          V.optObject(),
};
const replay    = {};
const listQuery = {
    workflow_id: V.optString(200),
    status:      V.optEnumOf(['EXECUTED', 'BLOCKED_PENDING_APPROVAL', 'BLOCKED_ERROR', 'REPLAYED', 'REPLAY_BLOCKED']),
    limit:       V.optPosInt(),
    offset:      V.optPosInt(),
};

module.exports = { execute, replay, listQuery };
