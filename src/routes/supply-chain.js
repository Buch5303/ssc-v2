'use strict';
const express = require('express');
const scs = require('../services/supply-chain-service');
const entityHistory = require('../services/entity-history');

function _id(req, res) {
    if (!req.identity || !req.identity.userId || !req.identity.orgId) { res.status(401).json({ error: 'identity_required' }); return null; }
    return req.identity;
}

function createSupplyChainRoutes(db) {
    if (!db) throw new Error('db required');
    const router = express.Router();

    // === SUPPLIERS ===
    router.get('/suppliers', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.listSuppliers(db, { org_id: id.orgId, status: req.query.status, category: req.query.category, country: req.query.country, search: req.query.search, limit: req.query.limit, offset: req.query.offset });
        res.json(r);
    });
    router.get('/suppliers/:id', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.getSupplier(db, parseInt(req.params.id, 10), id.orgId);
        res.status(r.success ? 200 : 404).json(r);
    });
    router.post('/suppliers', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.createSupplier(db, { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 201 : 400).json(r);
    });
    router.put('/suppliers/:id', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.updateSupplier(db, parseInt(req.params.id, 10), { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 200 : r.error === 'governance_blocked' ? 202 : 400).json(r);
    });
    router.delete('/suppliers/:id', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.deleteSupplier(db, parseInt(req.params.id, 10), { org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 200 : r.error === 'governance_blocked' ? 202 : 400).json(r);
    });
    router.post('/suppliers/import', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.bulkImportSuppliers(db, { suppliers: req.body.suppliers, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 200 : r.error === 'governance_blocked' ? 202 : 400).json(r);
    });

    // === PARTS ===
    router.get('/parts', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.listParts(db, { org_id: id.orgId, category: req.query.category, criticality: req.query.criticality, supplier_id: req.query.supplier_id, search: req.query.search, limit: req.query.limit, offset: req.query.offset });
        res.json(r);
    });
    router.get('/parts/:id', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.getPart(db, parseInt(req.params.id, 10), id.orgId);
        res.status(r.success ? 200 : 404).json(r);
    });
    router.post('/parts', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.createPart(db, { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 201 : 400).json(r);
    });

    // === ORDERS ===
    router.get('/orders', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.listOrders(db, { org_id: id.orgId, status: req.query.status, supplier_id: req.query.supplier_id, limit: req.query.limit, offset: req.query.offset });
        res.json(r);
    });
    router.get('/orders/:id', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.getOrder(db, parseInt(req.params.id, 10), id.orgId);
        res.status(r.success ? 200 : 404).json(r);
    });
    router.post('/orders', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.createOrder(db, { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 201 : 400).json(r);
    });
    router.put('/orders/:id/status', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.updateOrderStatus(db, parseInt(req.params.id, 10), { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 200 : r.error === 'governance_blocked' ? 202 : 400).json(r);
    });

    // === HISTORY / LINEAGE ===
    router.get('/history/:entityType/:entityId', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await entityHistory.getHistory(db, id.orgId, req.params.entityType, parseInt(req.params.entityId, 10), { limit: req.query.limit });
        res.json(r);
    });

    addQueryRoutes(router, db);
    return router;
}

module.exports = createSupplyChainRoutes;

// ═══ QUERY ROUTES (Phase 2B) ═══
const qs = require('../services/query-service');

function addQueryRoutes(router, db) {
    // Advanced queries with filters
    router.get('/query/suppliers', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.querySuppliers(db, id.orgId, req.query));
    });
    router.get('/query/parts', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.queryParts(db, id.orgId, req.query));
    });
    router.get('/query/orders', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.queryOrders(db, id.orgId, req.query));
    });
    router.get('/query/shipments', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.queryShipments(db, id.orgId, req.query));
    });
    router.get('/query/certifications', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.queryCertifications(db, id.orgId, req.query));
    });
    router.get('/query/inspections', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.queryInspections(db, id.orgId, req.query));
    });

    // Relationship traversal
    router.get('/suppliers/:id/parts', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getSupplierParts(db, id.orgId, parseInt(req.params.id, 10)));
    });
    router.get('/suppliers/:id/certifications', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getSupplierCertifications(db, id.orgId, parseInt(req.params.id, 10)));
    });
    router.get('/suppliers/:id/orders', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getSupplierOrders(db, id.orgId, parseInt(req.params.id, 10)));
    });
    router.get('/orders/:id/line-items', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getOrderLineItems(db, id.orgId, parseInt(req.params.id, 10)));
    });
    router.get('/orders/:id/shipments', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getOrderShipments(db, id.orgId, parseInt(req.params.id, 10)));
    });
    router.get('/shipments/:id/inspections', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getShipmentInspections(db, id.orgId, parseInt(req.params.id, 10)));
    });

    // Timeline and history
    router.get('/timeline/:entityType', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getEntityTimeline(db, id.orgId, req.params.entityType, null, req.query));
    });
    router.get('/timeline/:entityType/:entityId', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getEntityTimeline(db, id.orgId, req.params.entityType, parseInt(req.params.entityId, 10), req.query));
    });
    router.get('/timeline/:entityType/:entityId/status-changes', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getStatusChanges(db, id.orgId, req.params.entityType, parseInt(req.params.entityId, 10)));
    });
    router.get('/timeline/:entityType/imports', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        res.json(await qs.getImportProvenance(db, id.orgId, req.params.entityType, req.query));
    });

    // New entity CRUD: shipments, inspections, certifications, line items
    router.post('/shipments', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.createShipment(db, { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 201 : 400).json(r);
    });
    router.get('/shipments/:sid', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.getShipment(db, parseInt(req.params.sid, 10), id.orgId);
        res.status(r.success ? 200 : 404).json(r);
    });
    router.post('/inspections', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.createInspection(db, { ...req.body, org_id: id.orgId, inspector_user_id: id.userId });
        res.status(r.success ? 201 : 400).json(r);
    });
    router.post('/certifications', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.createCertification(db, { ...req.body, org_id: id.orgId, actor_user_id: id.userId });
        res.status(r.success ? 201 : 400).json(r);
    });
    router.post('/orders/:id/line-items', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        const r = await scs.addLineItem(db, { ...req.body, org_id: id.orgId, po_id: parseInt(req.params.id, 10) });
        res.status(r.success ? 201 : 400).json(r);
    });
}
