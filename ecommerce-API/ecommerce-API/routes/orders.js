const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../models/db');
const PDFDocument = require('pdfkit');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');
const shiprocketService = require('../services/shiprocketService');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_ID',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET'
});

// Add authMiddleware definition directly here to resolve import issues
function authMiddleware(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const jwt = require('jsonwebtoken');
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
}

// Place /my route first, protected for customers
router.get('/my', authMiddleware(['customer']), async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    const userId = payload.id;
    const db = getDB();
    
    // First try to find customer by user_id
    let customer = await db.collection('customers').findOne({ user_id: new ObjectId(userId) });
    
    // If not found by user_id, try to find by user's email
    if (!customer) {
      const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
      if (user && user.email) {
        customer = await db.collection('customers').findOne({ email: user.email });
        
        // If customer found by email but doesn't have user_id, update it
        if (customer && !customer.user_id) {
          await db.collection('customers').updateOne(
            { _id: customer._id },
            { $set: { user_id: new ObjectId(userId), updatedAt: new Date() } }
          );
          customer.user_id = new ObjectId(userId);
        }
      }
    }
    
    if (!customer) {
      // Try one more fallback - check all customers for this user's email
      const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
      if (user && user.email) {
        const allCustomers = await db.collection('customers').find({}).toArray();
        customer = allCustomers.find(c => c.email === user.email);
        
        if (customer) {
          // Update this customer with the user_id
          await db.collection('customers').updateOne(
            { _id: customer._id },
            { $set: { user_id: new ObjectId(userId), updatedAt: new Date() } }
          );
          customer.user_id = new ObjectId(userId);
        }
      }
      
      if (!customer) {
        return res.json({ success: true, orders: [], total: 0 });
      }
    }
    // Find orders for this customer
    const orders = await db.collection('orders')
      .find({ customer_id: customer._id })
      .sort({ createdAt: -1 })
      .toArray();
        
    res.json({
      success: true,
      orders,
      total: orders.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch your orders' });
  }
});

// Payment routes - allow customers to access these
// Create Razorpay Order
router.post('/payments/create-razorpay-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, items, deliveryDetails, deliveryCharge } = req.body;
    if (!amount) return res.status(400).json({ error: 'Amount is required' });
    
    const db = getDB();
    
    // Get user ID from token
    const authHeader = req.headers.authorization;
    let userId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        userId = payload.id;
      } catch (err) {
        console.log('Token verification failed, proceeding without user_id');
      }
    }
    
    // Create or find customer record
    let customer = await db.collection('customers').findOne({ 
      email: deliveryDetails.email 
    });
    
    if (!customer) {
      const customerData = {
        name: deliveryDetails.fullName,
        email: deliveryDetails.email,
        phone: deliveryDetails.phone,
        address: `${deliveryDetails.address}, ${deliveryDetails.city}, ${deliveryDetails.state} - ${deliveryDetails.pincode}`,
        customer_type: 'online',
        user_id: userId ? new ObjectId(userId) : null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const customerResult = await db.collection('customers').insertOne(customerData);
      customer = { _id: customerResult.insertedId, ...customerData };
    } else if (userId && !customer.user_id) {
      // Update existing customer with user_id if not already set
      await db.collection('customers').updateOne(
        { _id: customer._id },
        { $set: { user_id: new ObjectId(userId), updatedAt: new Date() } }
      );
      customer.user_id = new ObjectId(userId);
    }
    
    // Calculate order totals
    let total_amount = 0;
    const orderItems = await Promise.all(items.map(async (item) => {
      const product = await db.collection('products').findOne({ _id: new ObjectId(item._id) });
      if (!product) {
        throw new Error(`Product not found: ${item._id}`);
      }
      
      const price = product.price;
      const itemTotal = price * item.quantity;
      total_amount += itemTotal;
      
      return {
        product_id: new ObjectId(item._id),
        product_name: product.name,
        quantity: item.quantity,
        price: price,
        total_price: itemTotal
      };
    }));
    
    // Create order in database
    const newOrder = {
      customer_id: customer._id,
      customer_name: deliveryDetails.fullName,
      customer_email: deliveryDetails.email,
      customer_contact: deliveryDetails.phone,
      customer_address: `${deliveryDetails.address}, ${deliveryDetails.city}, ${deliveryDetails.state} - ${deliveryDetails.pincode}`,
      delivery_instructions: deliveryDetails.deliveryInstructions || '',
      order_type: 'online',
      payment_type: 'Razorpay',
      payment_status: 'Pending',
      total_amount,
      delivery_charge: deliveryCharge || 0,
      final_amount: amount, // This is the total including delivery charge
      status: 'Pending',
      items: orderItems,
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      delivery_status: 'Pending',
      delivery_tracking_link: ''
    };
    const orderResult = await db.collection('orders').insertOne(newOrder);
    const orderId = orderResult.insertedId;
    
    // Create Razorpay order
    const options = {
      amount: Math.round(amount * 100), // Razorpay expects paise
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      payment_capture: 1,
      notes: {
        order_id: orderId.toString(),
        customer_id: customer._id.toString()
      }
    };
    const razorpayOrder = await razorpay.orders.create(options);
    
    res.json({ 
      success: true, 
      order: razorpayOrder,
      dbOrderId: orderId.toString()
    });
  } catch (err) {
    console.error('Razorpay order creation error:', err);
    res.status(500).json({ error: 'Failed to create Razorpay order' });
  }
});

// Verify Razorpay Payment
const sanitizeName = (name) => {
  if (!name) return 'Customer';
  try {
    return String(name)
      .replace(/[^\p{L}\p{N}\s.\-,'&()]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Customer';
  } catch {
    return 'Customer';
  }
};

// Route to create Razorpay invoice
router.post('/payments/create-razorpay-invoice', async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });

    const db = getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    if (!order.customer_email) {
      return res.status(400).json({ success: false, error: 'Customer email is required to send invoice' });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ success: false, error: 'Razorpay credentials missing' });
    }

    const auth = {
      username: process.env.RAZORPAY_KEY_ID,
      password: process.env.RAZORPAY_KEY_SECRET
    };

    const line_items = (order.items || []).map(item => ({
      name: item.product_name,
      description: item.product_name,
      amount: Math.round((item.total_price || 0) * 100),
      currency: 'INR',
      quantity: item.quantity || 1
    }));

    const invoicePayload = {
      type: 'invoice',
      description: `Invoice for Order ${order.order_number || order._id}`,
      customer: {
        name: sanitizeName(order.customer_name || ''),
        email: order.customer_email
      },
      line_items,
      currency: 'INR',
      partial_payment: false,
      sms_notify: true,
      email_notify: true,
      receipt: `INV_${order.order_number || order._id}`
    };

    // Create invoice
    const invoiceResp = await axios.post(
      'https://api.razorpay.com/v1/invoices',
      invoicePayload,
      { auth }
    );

    // If invoice is in draft, send email explicitly
    if (invoiceResp.data.status === 'draft') {
      await axios.post(
        `https://api.razorpay.com/v1/invoices/${invoiceResp.data.id}/notify_by_email`,
        {},
        { auth }
      );
    }

    // Save invoice info to DB
    await db.collection('orders').updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          razorpay_invoice_id: invoiceResp.data.id,
          invoice_status: invoiceResp.data.status,
          invoice_created_at: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: 'Invoice created and emailed to customer',
      invoice: invoiceResp.data
    });

  } catch (err) {
    console.error('Error creating Razorpay invoice:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Route to verify direct Razorpay order payment
router.post('/payments/verify-razorpay', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !orderId) {
      return res.status(400).json({ success: false, error: 'Razorpay payment details and orderId are required' });
    }

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET')
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Payment signature verification failed' });
    }

    const db = getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    // Update order as paid
    await db.collection('orders').updateOne(
      { _id: new ObjectId(orderId) },
      {
        $set: {
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          payment_status: 'completed',
          updatedAt: new Date()
        }
      }
    );

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (err) {
    console.error('Error verifying Razorpay payment:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/razorpay-webhook', async (req, res) => {
  try {
    const event = req.body.event;
    const payload = req.body.payload;

    const db = getDB();

    if (event === 'invoice.paid') {
      const invoice = payload.invoice.entity;
      const invoiceId = invoice.id;

      await db.collection('orders').updateOne(
        { razorpay_invoice_id: invoiceId },
        {
          $set: {
            payment_status: 'completed',
            updatedAt: new Date(),
            payment_details: {
              invoice_id: invoiceId,
              amount_paid: invoice.amount_paid / 100,
              currency: invoice.currency
            }
          }
        }
      );
    }

    else if (event === 'payment.captured') {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;

      await db.collection('orders').updateOne(
        { razorpay_order_id: orderId },
        {
          $set: {
            payment_status: 'completed',
            updatedAt: new Date(),
            payment_details: {
              payment_id: payment.id,
              amount_paid: payment.amount / 100,
              currency: payment.currency,
              method: payment.method,
              email: payment.email,
              contact: payment.contact
            }
          }
        }
      );
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('error');
  }
});



// Get offline orders
router.get('/offline', async (req, res) => {
  try {
    const db = getDB();
    const orders = await db.collection('orders')
      .find({ order_type: 'offline' })
      .sort({ createdAt: -1 })
      .toArray();
    
    res.json({
      success: true,
      orders: orders,
      total: orders.length
    });
  } catch (err) {
    console.error('Offline orders fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch offline orders'
    });
  }
});

// Create offline order
router.post('/offline', async (req, res) => {
  try {
    const { 
      customerName, customerPhone, customerAddress, 
      items, totalAmount, paymentStatus, orderStatus, notes 
    } = req.body;
    const db = getDB();
    
    // Find or create customer
    let customer = await db.collection('customers').findOne({ 
      phone: customerPhone 
    });
    
    if (!customer) {
      const customerData = {
        name: customerName,
        phone: customerPhone,
        address: customerAddress,
        customer_type: 'offline',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const customerResult = await db.collection('customers').insertOne(customerData);
      customer = { _id: customerResult.insertedId, ...customerData };
    }
    
    // Create order
    const newOrder = {
      customer_id: customer._id,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      order_type: 'offline',
      payment_type: 'Cash',
      payment_status: paymentStatus || 'Paid',
      total_amount: totalAmount,
      final_amount: totalAmount,
      status: orderStatus || 'Confirmed',
      items: items,
      notes: notes || '',
      created_by: req.user?.id || 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
      delivery_status: 'Pending',
      delivery_tracking_link: ''
    };
    
    const result = await db.collection('orders').insertOne(newOrder);
    newOrder._id = result.insertedId;
    
    res.json({
      success: true,
      order: newOrder
    });
  } catch (err) {
    console.error('Offline order creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create offline order'
    });
  }
});

// Download orders report
router.get('/reports/download', async (req, res) => {
  try {
    const { type, fromDate, toDate } = req.query;
    const db = getDB();
    
    let query = {};
    if (fromDate && toDate) {
      query.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate + 'T23:59:59.999Z')
      };
    }
    
    if (type === 'offline') {
      query.order_type = 'offline';
    } else if (type === 'online') {
      query.order_type = 'online';
    }
    
    const orders = await db.collection('orders')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    // Generate Excel file
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');
    
    // Add headers
    worksheet.columns = [
      { header: 'Order ID', key: 'orderId', width: 15 },
      { header: 'Customer Name', key: 'customerName', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Order Type', key: 'orderType', width: 12 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Order Status', key: 'orderStatus', width: 15 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Items Count', key: 'itemsCount', width: 12 },
      { header: 'Created Date', key: 'createdDate', width: 20 },
      { header: 'Notes', key: 'notes', width: 30 }
    ];
    
    // Add data
    orders.forEach(order => {
      worksheet.addRow({
        orderId: order._id.toString().slice(-8),
        customerName: order.customer_name || 'N/A',
        phone: order.customer_phone || order.customer_contact || 'N/A',
        orderType: order.order_type || 'N/A',
        paymentStatus: order.payment_status || 'N/A',
        orderStatus: order.status || 'N/A',
        totalAmount: order.final_amount || order.total_amount || 0,
        itemsCount: order.items?.length || 0,
        createdDate: new Date(order.createdAt).toLocaleDateString(),
        notes: order.notes || ''
      });
    });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_orders_${fromDate}_to_${toDate}.xlsx"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Report download error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate report'
    });
  }
});

// Protect all other routes for admin/staff only
router.use(authMiddleware(['admin', 'staff']));

// Get all orders with filters
router.get('/', async (req, res) => {
  try {
    const { 
      order_type, status, payment_type, start_date, end_date, 
      sort = 'createdAt', order = 'desc', search 
    } = req.query;
    const db = getDB();
    
    let query = {};
    
    // Filter by order type
    if (order_type) {
      query.order_type = order_type;
    }
    
    // Filter by status
    if (status) {
      query.status = status;
    }
    
    // Filter by payment type
    if (payment_type) {
      query.payment_type = payment_type;
    }
    
    // Filter by date range
    if (start_date || end_date) {
      query.createdAt = {};
      if (start_date) query.createdAt.$gte = new Date(start_date);
      if (end_date) query.createdAt.$lte = new Date(end_date);
    }
    
    // Search by customer name or order number
    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { order_number: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Sort options
    let sortObj = {};
    sortObj[sort] = order === 'desc' ? -1 : 1;
    
    const orders = await db.collection('orders')
      .aggregate([
        { $match: query },
        { $sort: sortObj },
        {
          $project: {
            _id: 1,
            order_number: 1,
            customer_name: 1,
            customer_contact: 1,
            order_type: 1,
            payment_type: 1,
            payment_status: 1,
            total_amount: 1,
            final_amount: 1,
            status: 1,
            delivery_status: 1,
            delivery_tracking_link: 1,
            items: 1,
            createdAt: 1,
            updatedAt: 1
          }
        }
      ]).toArray();
    

    
    res.json({
      success: true,
      orders: orders,
      total: orders.length
    });
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
});

// Get order statistics
router.get('/stats', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const db = getDB();
    
    let dateFilter = {};
    if (start_date || end_date) {
      dateFilter.createdAt = {};
      if (start_date) dateFilter.createdAt.$gte = new Date(start_date);
      if (end_date) dateFilter.createdAt.$lte = new Date(end_date);
    }
    
    const stats = await db.collection('orders').aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          total_orders: { $sum: 1 },
          total_revenue: { $sum: '$final_amount' },
          online_orders: {
            $sum: { $cond: [{ $eq: ['$order_type', 'online'] }, 1, 0] }
          },
          physical_orders: {
            $sum: { $cond: [{ $eq: ['$order_type', 'physical'] }, 1, 0] }
          },
          pending_orders: {
            $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] }
          },
          delivered_orders: {
            $sum: { $cond: [{ $eq: ['$status', 'Delivered'] }, 1, 0] }
          }
        }
      }
    ]).toArray();
    
    const paymentStats = await db.collection('orders').aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$payment_type',
          count: { $sum: 1 },
          total: { $sum: '$final_amount' }
        }
      }
    ]).toArray();
    
    res.json({
      success: true,
      stats: stats[0] || {
        total_orders: 0,
        total_revenue: 0,
        online_orders: 0,
        physical_orders: 0,
        pending_orders: 0,
        delivered_orders: 0
      },
      payment_stats: paymentStats
    });
  } catch (err) {
    console.error('Order stats error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order statistics'
    });
  }
});

// Get single order
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      order: order
    });
  } catch (err) {
    console.error('Order fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
});

// Create online order
router.post('/online', async (req, res) => {
  try {
    const { 
      customer_name, customer_email, customer_contact, customer_address, 
      payment_type, payment_status, items, notes 
    } = req.body;
    const db = getDB();
    
    // Find or create customer
    let customer = await db.collection('customers').findOne({ 
      email: customer_email 
    });
    
    if (!customer) {
      const customerData = {
        name: customer_name,
        email: customer_email,
        phone: customer_contact,
        address: customer_address,
        customer_type: 'online',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const customerResult = await db.collection('customers').insertOne(customerData);
      customer = { _id: customerResult.insertedId, ...customerData };
    }
    
    // Calculate order totals
    let total_amount = 0;
    let tax_amount = 0;
    let discount_amount = 0;
    
    const orderItems = await Promise.all(items.map(async (item) => {
      const product = await db.collection('products').findOne({ _id: new ObjectId(item.product_id) });
      if (!product) {
        throw new Error(`Product not found: ${item.product_id}`);
      }
      
      const price = product.price;
      const itemTotal = price * item.quantity;
      total_amount += itemTotal;
      
      return {
        product_id: new ObjectId(item.product_id),
        product_name: product.name,
        quantity: item.quantity,
        price: price,
        total_price: itemTotal
      };
    }));
    
    // Calculate final amount (with tax and discount)
    const final_amount = total_amount + tax_amount - discount_amount;
    
    // Create order
    const newOrder = {
      customer_id: customer._id,
      customer_name,
      customer_email,
      customer_contact,
      customer_address,
      order_type: 'online',
      payment_type: payment_type || 'Online',
      payment_status: payment_status || 'Pending',
      total_amount,
      tax_amount,
      discount_amount,
      final_amount,
      status: 'Pending',
      items: orderItems,
      notes: notes || '',
      created_by: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      delivery_status: 'Pending',
      delivery_tracking_link: ''
    };
    
    const result = await db.collection('orders').insertOne(newOrder);
    newOrder._id = result.insertedId;
    
    // Reduce stock for each product
    for (const item of orderItems) {
      await db.collection('products').updateOne(
        { _id: item.product_id },
        { 
          $inc: { stock_quantity: -item.quantity },
          $set: { updatedAt: new Date() }
        }
      );
    }
    
    res.json({
      success: true,
      order: newOrder
    });
  } catch (err) {
    console.error('Online order creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create online order'
    });
  }
});

// Create physical order
router.post('/physical', async (req, res) => {
  try {
    const { 
      customer_name, customer_contact, customer_address, 
      payment_type, items, notes 
    } = req.body;
    const db = getDB();
    
    // Find or create customer
    let customer = await db.collection('customers').findOne({ 
      phone: customer_contact 
    });
    
    if (!customer) {
      const customerData = {
        name: customer_name,
        phone: customer_contact,
        address: customer_address,
        customer_type: 'physical',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const customerResult = await db.collection('customers').insertOne(customerData);
      customer = { _id: customerResult.insertedId, ...customerData };
    }
    
    // Calculate order totals
    let total_amount = 0;
    let tax_amount = 0;
    let discount_amount = 0;
    
    const orderItems = await Promise.all(items.map(async (item) => {
      const product = await db.collection('products').findOne({ _id: new ObjectId(item.product_id) });
      if (!product) {
        throw new Error(`Product not found: ${item.product_id}`);
      }
      
      const price = product.price;
      const itemTotal = price * item.quantity;
      total_amount += itemTotal;
      
      return {
        product_id: new ObjectId(item.product_id),
        product_name: product.name,
        quantity: item.quantity,
        price: price,
        total_price: itemTotal
      };
    }));
    
    // Calculate final amount
    const final_amount = total_amount + tax_amount - discount_amount;
    
    // Create order
    const newOrder = {
      customer_id: customer._id,
      customer_name,
      customer_contact,
      customer_address,
      order_type: 'physical',
      payment_type: payment_type || 'Cash',
      payment_status: 'Paid',
      total_amount,
      tax_amount,
      discount_amount,
      final_amount,
      status: 'Confirmed',
      items: orderItems,
      notes: notes || '',
      created_by: req.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      delivery_status: 'Pending',
      delivery_tracking_link: ''
    };
    
    const result = await db.collection('orders').insertOne(newOrder);
    newOrder._id = result.insertedId;
    
    // Reduce stock for each product
    for (const item of orderItems) {
      await db.collection('products').updateOne(
        { _id: item.product_id },
        { 
          $inc: { stock_quantity: -item.quantity },
          $set: { updatedAt: new Date() }
        }
      );
    }
    
    res.json({
      success: true,
      order: newOrder
    });
  } catch (err) {
    console.error('Physical order creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create physical order'
    });
  }
});

// Admin: Set delivery link for a paid order
router.patch('/:id/delivery-link', async (req, res) => {
  try {
    const db = getDB();
    const { delivery_link } = req.body;
    if (!delivery_link) return res.status(400).json({ success: false, message: 'Delivery link required' });
    
    // Only allow if order is paid
    const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
    
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.payment_status !== 'Paid') return res.status(400).json({ success: false, message: 'Order not paid' });
    
    await db.collection('orders').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { delivery_tracking_link: delivery_link } }
    );
    
    res.json({ success: true, message: 'Delivery link updated' });
  } catch (err) {
    console.error('Delivery link update error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update order status
router.patch('/:id/status', async (req, res) => {
  try {
    // Validate ObjectId
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID format'
      });
    }
    
    const { status, tracking_number, delivery_date, delivery_status, delivery_tracking_link, delivery_link } = req.body;
    const db = getDB();
    
    const updateData = {
      status,
      updatedAt: new Date()
    };
    
    if (tracking_number) updateData.tracking_number = tracking_number;
    if (delivery_date) updateData.delivery_date = new Date(delivery_date);
    if (delivery_status) updateData.delivery_status = delivery_status;
    if (delivery_tracking_link) updateData.delivery_tracking_link = delivery_tracking_link;
    if (delivery_link) updateData.delivery_tracking_link = delivery_link; // Map delivery_link to delivery_tracking_link for consistency
    
    const result = await db.collection('orders').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      order: result.value
    });
  } catch (err) {
    console.error('Order status update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status'
    });
  }
});

// Update payment status
router.patch('/:id/payment', async (req, res) => {
  try {
    const { payment_status, payment_type } = req.body;
    const db = getDB();
    
    const updateData = {
      payment_status,
      updatedAt: new Date()
    };
    
    if (payment_type) updateData.payment_type = payment_type;
    
    const result = await db.collection('orders').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      order: result.value
    });
  } catch (err) {
    console.error('Payment status update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment status'
    });
  }
});



// Generate bill PDF
router.get('/:id/bill', async (req, res) => {
  try {
    const db = getDB();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(req.params.id) });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Generate PDF
    const doc = new PDFDocument();
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);
      res.set({ 
        'Content-Type': 'application/pdf', 
        'Content-Disposition': `attachment; filename="RTQ_Bill_${order.order_number}.pdf"` 
      });
      res.send(pdfData);
    });
    
    // PDF content
    doc.fontSize(20).text('RTQ Foods', { align: 'center' });
    doc.fontSize(16).text('Invoice/Bill', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(12).text(`Order Number: ${order.order_number}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`);
    doc.text(`Time: ${new Date(order.createdAt).toLocaleTimeString()}`);
    doc.moveDown();
    
    doc.text('Customer Details:');
    doc.text(`Name: ${order.customer_name}`);
    doc.text(`Contact: ${order.customer_contact}`);
    if (order.customer_email) doc.text(`Email: ${order.customer_email}`);
    if (order.customer_address) {
      if (typeof order.customer_address === 'object') {
        doc.text(`Address: ${order.customer_address.street || ''}, ${order.customer_address.city || ''}, ${order.customer_address.state || ''} - ${order.customer_address.pincode || ''}`);
      } else {
        doc.text(`Address: ${order.customer_address}`);
      }
    }
    doc.moveDown();
    
    doc.text('Items:');
    doc.text('----------------------------------------');
    order.items.forEach((item, index) => {
      doc.text(`${index + 1}. ${item.product_name}`);
      doc.text(`   Quantity: ${item.quantity} x ₹${item.price} = ₹${item.total_price}`);
    });
    doc.text('----------------------------------------');
    doc.moveDown();
    
    doc.text(`Subtotal: ₹${order.total_amount}`);
    if (order.tax_amount > 0) doc.text(`Tax: ₹${order.tax_amount}`);
    if (order.discount_amount > 0) doc.text(`Discount: ₹${order.discount_amount}`);
    doc.fontSize(14).text(`Total Amount: ₹${order.final_amount}`, { align: 'right' });
    doc.moveDown();
    
    doc.fontSize(12).text(`Payment Type: ${order.payment_type}`);
    doc.text(`Payment Status: ${order.payment_status}`);
    
    doc.end();
  } catch (err) {
    console.error('Bill generation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate bill'
    });
  }
});



// Delete order
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('orders').deleteOne({ _id: new ObjectId(req.params.id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (err) {
    console.error('Order deletion error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete order'
    });
  }
});



module.exports = router; 