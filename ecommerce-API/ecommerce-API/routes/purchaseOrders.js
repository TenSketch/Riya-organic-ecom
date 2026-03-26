const express = require('express');
const router = express.Router();
const { getDB } = require('../models/db');
const { ObjectId } = require('mongodb');
const PDFDocument = require('pdfkit');

// Create PO
router.post('/', async (req, res) => {
  const { supplier_name, items, status, purchase_date, notes } = req.body;
  try {
    let total_cost = 0;
    const poItems = await Promise.all(items.map(async (item) => {
      const db = getDB();
      let product = null;
      if (item.product_id && typeof item.product_id === 'string' && item.product_id.length === 24) {
        try {
          product = await db.collection('products').findOne({ _id: new ObjectId(item.product_id) });
        } catch {}
      }
      const purchase_price = item.purchase_price || (product ? product.price : 0);
      total_cost += purchase_price * item.quantity;
      return {
        product_id: item.product_id,
        product_name: product ? product.name : item.product_name,
        quantity: item.quantity,
        purchase_price
      };
    }));
    const db = getDB();
    const result = await db.collection('purchaseOrders').insertOne({
      supplier_name,
      items: poItems,
      total_cost,
      status: status || 'Ordered',
      purchase_date,
      notes
    });
    const po = await db.collection('purchaseOrders').findOne({ _id: result.insertedId });
    res.json({ success: true, purchaseOrder: po });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all POs (with filters)
router.get('/', async (req, res) => {
  const { status, supplier_name, start_date, end_date } = req.query;
  try {
    const db = getDB();
    let query = {};
    if (status) query.status = status;
    if (supplier_name) query.supplier_name = { $regex: supplier_name, $options: 'i' };
    if (start_date || end_date) {
      query.purchase_date = {};
      if (start_date) query.purchase_date.$gte = new Date(start_date);
      if (end_date) query.purchase_date.$lte = new Date(end_date);
    }
    const pos = await db.collection('purchaseOrders').find(query).sort({ purchase_date: -1 }).toArray();
    res.json({ success: true, purchaseOrders: pos });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get single PO
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const po = await db.collection('purchaseOrders').findOne({ _id: new ObjectId(req.params.id) });
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });
    res.json({ success: true, purchaseOrder: po });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update PO
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    let po = null;
    let triedObjectId = false;
    console.log('PUT ID:', req.params.id);
    try {
      po = await db.collection('purchaseOrders').findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
        { returnDocument: 'after', returnOriginal: false }
      );
      triedObjectId = true;
    } catch (e) {
      // Invalid ObjectId, skip
      console.log('Invalid ObjectId:', req.params.id);
    }
    if (po && po.value) {
      return res.json({ success: true, purchaseOrder: po.value, method: triedObjectId ? 'ObjectId' : 'string' });
    }
    // Try as string
    po = await db.collection('purchaseOrders').findOneAndUpdate(
      { _id: req.params.id },
      { $set: req.body },
      { returnDocument: 'after', returnOriginal: false }
    );
    if (po && po.value) {
      return res.json({ success: true, purchaseOrder: po.value, method: 'string' });
    }
    // If update happened but po.value is falsy, fetch the PO by ID
    const updated = await db.collection('purchaseOrders').findOne({ _id: new ObjectId(req.params.id) });
    if (updated) {
      return res.json({ success: true, purchaseOrder: updated, method: 'ObjectId-fallback' });
    }
    const updatedStr = await db.collection('purchaseOrders').findOne({ _id: req.params.id });
    if (updatedStr) {
      return res.json({ success: true, purchaseOrder: updatedStr, method: 'string-fallback' });
    }
    return res.status(404).json({ success: false, message: 'PO not found', id: req.params.id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Delete PO
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    let po = null;
    let triedObjectId = false;
    try {
      po = await db.collection('purchaseOrders').findOneAndDelete({ _id: new ObjectId(req.params.id) });
      triedObjectId = true;
      console.log('ObjectId delete result:', po);
      if (po) {
        return res.json({ success: true, message: 'PO deleted', deleted: po, method: 'ObjectId' });
      }
    } catch (e) {
      console.log('Invalid ObjectId or error:', e);
    }
    // Try as string
    po = await db.collection('purchaseOrders').findOneAndDelete({ _id: req.params.id });
    console.log('String delete result:', po);
    if (po) {
      return res.json({ success: true, message: 'PO deleted', deleted: po, method: 'string' });
    }
    return res.status(404).json({ success: false, message: 'PO not found', id: req.params.id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
});

// Download/Print PO as PDF
router.get('/:id/print', async (req, res) => {
  try {
    const db = getDB();
    const po = await db.collection('purchaseOrders').findOne({ _id: new ObjectId(req.params.id) });
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });
    const doc = new PDFDocument();
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="po_${po._id}.pdf"` });
      res.send(pdfData);
    });
    doc.fontSize(18).text('Purchase Order', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`PO ID: ${po._id}`);
    doc.text(`Supplier: ${po.supplier_name}`);
    doc.text(`Date: ${po.purchase_date.toLocaleString()}`);
    doc.text(`Status: ${po.status}`);
    doc.moveDown();
    doc.text('Items:');
    po.items.forEach(item => {
      doc.text(`- ${item.product_name} x${item.quantity} @ ₹${item.purchase_price}`);
    });
    doc.moveDown();
    doc.text(`Total Cost: ₹${po.total_cost}`);
    doc.text(`Notes: ${po.notes}`);
    doc.end();
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router; 