'use strict';
const express = require('express');
const scs = require('../services/supply-chain-service');
const entityHistory = require('../services/entity-history');

function _id(req, res) {
    if (!req.identity || !req.identity.userId || !req.identity.orgId) { res.status(401).json({ error: 'identity_required' }); return null; }
    return req.identity;
}

function createSupplyChainRoutes(db) {
    const router = express.Router();

    // Suppliers
    router.get('/suppliers', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ suppliers: scs.listSuppliers(db, id.orgId, req.query) });
    });
    router.post('/suppliers', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.createSupplier(db, id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/suppliers/:id', (req, res) => {
        const id = _id(req, res); if (!id) return;
        const row = scs.getSupplier(db, id.orgId, req.params.id);
        if (!row) return res.status(404).json({ error: 'not_found' });
        return res.json(row);
    });
    router.put('/suppliers/:id', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try {
            const row = scs.updateSupplier(db, id, req.params.id, req.body || {});
            if (!row) return res.status(404).json({ error: 'not_found' });
            return res.json(row);
        } catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.delete('/suppliers/:id', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        try {
            const result = await scs.deleteSupplier(db, id, req.params.id, { reason: req.body && req.body.reason });
            return res.status(result.status === 'PENDING' ? 202 : 200).json(result);
        } catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.post('/suppliers/import', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        try {
            const result = await scs.bulkImportSuppliers(db, id, req.body && req.body.records || [], { source: req.body && req.body.source, correlationId: req.body && req.body.correlationId });
            return res.status(result.status === 'PENDING' ? 202 : 201).json(result);
        } catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/suppliers/:id/parts', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ parts: scs.getSupplierParts(db, id.orgId, req.params.id) });
    });
    router.get('/suppliers/:id/certifications', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ certifications: scs.getSupplierCertifications(db, id.orgId, req.params.id) });
    });
    router.get('/suppliers/:id/orders', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ orders: scs.getSupplierOrders(db, id.orgId, req.params.id) });
    });

    // Parts
    router.get('/parts', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ parts: scs.listParts(db, id.orgId, req.query) });
    });
    router.post('/parts', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.createPart(db, id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/parts/:id', (req, res) => {
        const id = _id(req, res); if (!id) return;
        const row = scs.getPart(db, id.orgId, req.params.id);
        if (!row) return res.status(404).json({ error: 'not_found' });
        return res.json(row);
    });

    // Orders
    router.get('/orders', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ orders: scs.listOrders(db, id.orgId, req.query) });
    });
    router.post('/orders', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.createOrder(db, id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/orders/:id', (req, res) => {
        const id = _id(req, res); if (!id) return;
        const row = scs.getOrder(db, id.orgId, req.params.id);
        if (!row) return res.status(404).json({ error: 'not_found' });
        return res.json(row);
    });
    router.put('/orders/:id/status', async (req, res) => {
        const id = _id(req, res); if (!id) return;
        try {
            const result = await scs.updateOrderStatus(db, id, req.params.id, req.body && req.body.status, { reason: req.body && req.body.reason });
            return res.status(result.status === 'PENDING' ? 202 : 200).json(result);
        } catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/orders/:id/line-items', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ line_items: scs.getOrderLineItems(db, id.orgId, req.params.id) });
    });
    router.post('/orders/:id/line-items', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.addOrderLineItem(db, id, req.params.id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/orders/:id/shipments', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ shipments: scs.getOrderShipments(db, id.orgId, req.params.id) });
    });

    // Shipments / inspections / certs
    router.post('/shipments', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.createShipment(db, id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.get('/shipments/:sid', (req, res) => {
        const id = _id(req, res); if (!id) return;
        const row = scs.getShipment(db, id.orgId, req.params.sid);
        if (!row) return res.status(404).json({ error: 'not_found' });
        return res.json(row);
    });
    router.get('/shipments/:id/inspections', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ inspections: scs.getShipmentInspections(db, id.orgId, req.params.id) });
    });
    router.post('/inspections', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.createInspection(db, id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });
    router.post('/certifications', (req, res) => {
        const id = _id(req, res); if (!id) return;
        try { return res.status(201).json(scs.createCertification(db, id, req.body || {})); }
        catch (e) { return res.status(400).json({ error: e.message }); }
    });

    // History
    router.get('/history/:entityType/:entityId', (req, res) => {
        const id = _id(req, res); if (!id) return;
        return res.json({ history: entityHistory.getHistory(db, id.orgId, req.params.entityType, req.params.entityId) });
    });

    return router;
}

module.exports = createSupplyChainRoutes;
