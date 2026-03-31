'use strict';

const express = require('express');
const executionService = require('../services/workflow-execution-service');
const { validate } = require('../common/validate');
const schemas = require('../schemas/workflows');

function _getTrustedContext(req) {
    const userId = (req.user && req.user.id) || req.headers['x-user-id'] || null;
    const orgId  = (req.org && req.org.id)   || req.headers['x-org-id']  || null;
    return { userId, orgId };
}

function _requireTrustedContext(req, res) {
    const ctx = _getTrustedContext(req);
    if (!ctx.userId) { res.status(401).json({ error: 'actor_user_id_not_in_trusted_context' }); return null; }
    if (!ctx.orgId)  { res.status(401).json({ error: 'org_id_not_in_trusted_context' });        return null; }
    return ctx;
}

function _parseId(val) {
    const n = parseInt(val, 10);
    return (isNaN(n) || n < 1) ? null : n;
}

function _clampPagination(query) {
    let limit = parseInt(query.limit, 10);
    let offset = parseInt(query.offset, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    if (isNaN(offset) || offset < 0) offset = 0;
    return { limit, offset };
}

function createWorkflowRoutes(db) {
    if (!db) throw new Error('[workflows] FATAL: db required — fail closed');

    const router = express.Router();

    // POST /:id/execute
    router.post('/:id/execute', (req, res) => {
        try {
            const ctx = _requireTrustedContext(req, res); if (!ctx) return;
            const vr = validate(req.body, schemas.execute);
            if (!vr.valid) return res.status(400).json({ error: 'validation_failed', details: vr.errors });
            const result = executionService.executeWorkflow(db, {
                org_id: ctx.orgId, workflow_id: req.params.id, actor_user_id: ctx.userId,
                action_type: vr.cleaned.action_type || 'execute',
                is_bulk: !!vr.cleaned.is_bulk,
                is_ai_originated: !!vr.cleaned.is_ai_originated,
                is_destructive: !!vr.cleaned.is_destructive,
                payload: vr.cleaned.payload || {},
            });
            if (!result.success && result.execution_status === 'BLOCKED_ERROR') return res.status(422).json(result);
            if (!result.success) return res.status(400).json(result);
            return res.status(result.execution_status === 'EXECUTED' ? 200 : 202).json(result);
        } catch (err) { return res.status(500).json({ error: err.message }); }
    });

    // POST /:id/replay
    router.post('/:id/replay', (req, res) => {
        try {
            const ctx = _requireTrustedContext(req, res); if (!ctx) return;
            const executionId = _parseId(req.params.id);
            if (!executionId) return res.status(400).json({ error: 'invalid_execution_id' });
            const result = executionService.replayApprovedExecution(db, {
                org_id: ctx.orgId, execution_id: executionId, actor_user_id: ctx.userId,
            });
            if (!result.success) {
                if (result.error === 'execution_not_found') return res.status(404).json(result);
                if (result.error === 'replay_already_executed') return res.status(409).json(result);
                if (typeof result.error === 'string' && result.error.startsWith('approval_not_approved')) return res.status(403).json(result);
                return res.status(400).json(result);
            }
            return res.json(result);
        } catch (err) { return res.status(500).json({ error: err.message }); }
    });

    // GET /executions
    router.get('/executions', (req, res) => {
        try {
            const ctx = _requireTrustedContext(req, res); if (!ctx) return;
            const pg = _clampPagination(req.query);
            const result = executionService.listExecutions(db, {
                org_id: ctx.orgId,
                workflow_id: req.query.workflow_id || undefined,
                execution_status: req.query.status || undefined,
                limit: pg.limit, offset: pg.offset,
            });
            if (!result.success) return res.status(500).json({ error: result.error });
            return res.json({ success: true, executions: result.executions, total: result.total, limit: pg.limit, offset: pg.offset });
        } catch (err) { return res.status(500).json({ error: err.message }); }
    });

    // GET /executions/:id
    router.get('/executions/:id', (req, res) => {
        try {
            const ctx = _requireTrustedContext(req, res); if (!ctx) return;
            const execId = _parseId(req.params.id);
            if (!execId) return res.status(400).json({ error: 'invalid_execution_id' });
            const result = executionService.getExecution(db, execId, ctx.orgId);
            if (!result.success) return res.status(404).json({ error: result.error });
            return res.json({ success: true, execution: result.execution });
        } catch (err) { return res.status(500).json({ error: err.message }); }
    });

    return router;
}

module.exports = createWorkflowRoutes;
