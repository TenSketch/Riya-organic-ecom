const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../models/db');
const jwt = require('jsonwebtoken');

// Middleware to authenticate user
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, message: 'No token provided' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// GET /api/cart - get current user's cart
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const cart = await db.collection('cart').findOne({ user_id: new ObjectId(req.user.id) });
    res.json({ success: true, cart: cart ? cart.items : [] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch cart' });
  }
});

// POST /api/cart - set/update current user's cart
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const items = req.body.items || [];
    await db.collection('cart').updateOne(
      { user_id: new ObjectId(req.user.id) },
      { $set: { items, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ success: true, message: 'Cart updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update cart' });
  }
});

// DELETE /api/cart - clear current user's cart
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.collection('cart').deleteOne({ user_id: new ObjectId(req.user.id) });
    res.json({ success: true, message: 'Cart cleared' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to clear cart' });
  }
});

module.exports = router; 