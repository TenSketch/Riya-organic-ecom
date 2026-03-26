const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../models/db');

// Get all customers with filters
router.get('/', async (req, res) => {
  try {
    const { search, sort = 'createdAt', order = 'desc' } = req.query;
    const db = getDB();
    
    let query = {};
    
    // Search by name, email, or phone
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Sort options
    let sortObj = {};
    sortObj[sort] = order === 'desc' ? -1 : 1;
    
    // Fetch from customers collection
    const customers = await db.collection('customers')
      .find(query)
      .sort(sortObj)
      .toArray();
    
    // Get all customer IDs and convert to strings for comparison
    const customerIds = customers.map(c => c._id.toString());
    
    // Aggregate orders for all customers using string comparison
    const orderAgg = await db.collection('orders').aggregate([
      { 
        $match: { 
          $expr: { 
            $in: [{ $toString: '$customer_id' }, customerIds] 
          } 
        } 
      },
      { $group: {
          _id: { $toString: '$customer_id' },
          total_orders: { $sum: 1 },
          total_spent: { $sum: '$final_amount' }
        }
      }
    ]).toArray();
    
    // Map for quick lookup
    const orderStatsMap = {};
    orderAgg.forEach(stat => {
      orderStatsMap[stat._id] = stat;
    });
    
    // Attach stats to each customer
    const customersWithStats = customers.map(c => {
      const stats = orderStatsMap[c._id.toString()] || { total_orders: 0, total_spent: 0 };
      return {
        ...c,
        total_orders: stats.total_orders,
        total_spent: stats.total_spent
      };
    });
    res.json({
      success: true,
      customers: customersWithStats,
      total: customersWithStats.length
    });
  } catch (err) {
    console.error('Customers fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers'
    });
  }
});

// Get customer statistics
router.get('/stats', async (req, res) => {
  try {
    const db = getDB();
    
    const stats = await db.collection('customers').aggregate([
      {
        $group: {
          _id: null,
          total_customers: { $sum: 1 },
          online_customers: {
            $sum: { $cond: [{ $eq: ['$customer_type', 'online'] }, 1, 0] }
          },
          physical_customers: {
            $sum: { $cond: [{ $eq: ['$customer_type', 'physical'] }, 1, 0] }
          },
          both_customers: {
            $sum: { $cond: [{ $eq: ['$customer_type', 'both'] }, 1, 0] }
          }
        }
      }
    ]).toArray();
    
    // Get top customers by order value
    const topCustomers = await db.collection('orders').aggregate([
      {
        $group: {
          _id: '$customer_id',
          customer_name: { $first: '$customer_name' },
          total_orders: { $sum: 1 },
          total_spent: { $sum: '$final_amount' }
        }
      },
      { $sort: { total_spent: -1 } },
      { $limit: 10 }
    ]).toArray();
    
    res.json({
      success: true,
      stats: stats[0] || {
        total_customers: 0,
        online_customers: 0,
        physical_customers: 0,
        both_customers: 0
      },
      top_customers: topCustomers
    });
  } catch (err) {
    console.error('Customer stats error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer statistics'
    });
  }
});

// Get single customer
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const customer = await db.collection('customers').findOne({ _id: new ObjectId(req.params.id) });
    
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    // Get customer orders
    const orders = await db.collection('orders')
      .find({ customer_id: new ObjectId(req.params.id) })
      .sort({ createdAt: -1 })
      .toArray();
    
    // Calculate customer statistics
    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum, order) => sum + order.final_amount, 0);
    const lastOrderDate = orders.length > 0 ? orders[0].createdAt : null;
    
    res.json({
      success: true,
      customer: {
        ...customer,
        total_orders: totalOrders,
        total_spent: totalSpent,
        last_order_date: lastOrderDate
      },
      orders: orders
    });
  } catch (err) {
    console.error('Customer fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer'
    });
  }
});

// Create customer
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, address, customer_type, notes } = req.body;
    const db = getDB();
    
    // Check if customer already exists
    const existingCustomer = await db.collection('customers').findOne({
      $or: [
        { email: email },
        { phone: phone }
      ]
    });
    
    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        message: 'Customer with this email or phone already exists'
      });
    }
    
    const newCustomer = {
      name,
      email,
      phone,
      address,
      customer_type: customer_type || 'online',
      total_orders: 0,
      total_spent: 0,
      is_active: true,
      notes: notes || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('customers').insertOne(newCustomer);
    newCustomer._id = result.insertedId;
    
    res.json({
      success: true,
      customer: newCustomer
    });
  } catch (err) {
    console.error('Customer creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create customer'
    });
  }
});

// Update customer
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };
    
    const result = await db.collection('customers').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    res.json({
      success: true,
      customer: result.value
    });
  } catch (err) {
    console.error('Customer update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update customer'
    });
  }
});

// Delete customer
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    
    // Check if customer has orders
    const hasOrders = await db.collection('orders').findOne({ customer_id: new ObjectId(req.params.id) });
    if (hasOrders) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with existing orders'
      });
    }
    
    const result = await db.collection('customers').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (err) {
    console.error('Customer deletion error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete customer'
    });
  }
});

module.exports = router; 