const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../models/db');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// Get dashboard overview
router.get('/overview', async (req, res) => {
  try {
    const db = getDB();
    
    // Get current date and start of month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    
    // Total sales (all time)
    const totalSalesResult = await db.collection('orders').aggregate([
      { $group: { _id: null, total: { $sum: '$final_amount' } } }
    ]).toArray();
    const totalSales = totalSalesResult.length > 0 ? totalSalesResult[0].total : 0;
    
    // Monthly sales
    const monthlySalesResult = await db.collection('orders').aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$final_amount' } } }
    ]).toArray();
    const monthlySales = monthlySalesResult.length > 0 ? monthlySalesResult[0].total : 0;
    
    // Total orders
    const totalOrders = await db.collection('orders').countDocuments();
    const monthlyOrders = await db.collection('orders').countDocuments({ createdAt: { $gte: startOfMonth } });
    
    // Low stock products
    const lowStockCount = await db.collection('products').countDocuments({
      $expr: { $lte: ['$stock_quantity', '$low_stock_threshold'] }
    });
    
    // Pending orders
    const pendingOrders = await db.collection('orders').countDocuments({ status: 'Pending' });
    
    // Total products
    const totalProducts = await db.collection('products').countDocuments();
    const activeProducts = await db.collection('products').countDocuments({ visible: true });
    
    // Total customers
    const totalCustomers = await db.collection('customers').countDocuments();
    
    // Revenue by order type
    const revenueByType = await db.collection('orders').aggregate([
      {
        $group: {
          _id: '$order_type',
          revenue: { $sum: '$final_amount' },
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    res.json({
      success: true,
      data: {
        totalSales,
        monthlySales,
        totalOrders,
        monthlyOrders,
        lowStockCount,
        pendingOrders,
        totalProducts,
        activeProducts,
        totalCustomers,
        revenueByType
      }
    });
  } catch (err) {
    console.error('Dashboard overview error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard overview'
    });
  }
});

// Get low stock alerts
router.get('/low-stock', async (req, res) => {
  try {
    const db = getDB();
    const lowStockProducts = await db.collection('products').aggregate([
      {
        $match: {
          $expr: { $lte: ['$stock_quantity', '$low_stock_threshold'] }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: 'category_id',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      { $sort: { stock_quantity: 1 } },
      {
        $project: {
          _id: 1,
          name: 1,
          stock_quantity: 1,
          low_stock_threshold: 1,
          category_name: '$category.name',
          price: 1
        }
      }
    ]).toArray();
    
    res.json({
      success: true,
      products: lowStockProducts
    });
  } catch (err) {
    console.error('Low stock fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch low stock products'
    });
  }
});

// Get top selling products
router.get('/top-products', async (req, res) => {
  try {
    const { limit = 5, period = 'all' } = req.query;
    const db = getDB();
    
    let dateFilter = {};
    if (period === 'month') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      dateFilter.createdAt = { $gte: startOfMonth };
    } else if (period === 'week') {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      dateFilter.createdAt = { $gte: startOfWeek };
    }
    
    const topProducts = await db.collection('orders').aggregate([
      { $match: dateFilter },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product_id',
          product_name: { $first: '$items.product_name' },
          total_quantity: { $sum: '$items.quantity' },
          total_sales: { $sum: '$items.total_price' }
        }
      },
      { $sort: { total_sales: -1 } },
      { $limit: parseInt(limit) }
    ]).toArray();
    
    res.json({
      success: true,
      products: topProducts
    });
  } catch (err) {
    console.error('Top products fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch top products'
    });
  }
});

// Get recent orders
router.get('/recent-orders', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const db = getDB();
    
    const recentOrders = await db.collection('orders')
      .find({})
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .project({
        _id: 1,
        order_number: 1,
        customer_name: 1,
        final_amount: 1,
        status: 1,
        order_type: 1,
        payment_status: 1,
        createdAt: 1
      })
      .toArray();
    
    res.json({
      success: true,
      orders: recentOrders
    });
  } catch (err) {
    console.error('Recent orders fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent orders'
    });
  }
});

// Get sales analytics
router.get('/sales-analytics', async (req, res) => {
  try {
    const { period = 'monthly', start_date, end_date } = req.query;
    const db = getDB();
    
    let dateFilter = {};
    if (start_date || end_date) {
      dateFilter.createdAt = {};
      if (start_date) dateFilter.createdAt.$gte = new Date(start_date);
      if (end_date) dateFilter.createdAt.$lte = new Date(end_date);
    }
    
    let groupBy;
    let dateFormat;
    
    if (period === 'monthly') {
      groupBy = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
      dateFormat = "%Y-%m";
    } else if (period === 'weekly') {
      groupBy = { $dateToString: { format: "%Y-%U", date: "$createdAt" } };
      dateFormat = "%Y-%U";
    } else {
      groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
      dateFormat = "%Y-%m-%d";
    }

    const salesData = await db.collection('orders').aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: groupBy,
          sales: { $sum: '$final_amount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    const formattedData = salesData.map(item => ({
      period: item._id,
      sales: item.sales,
      orders: item.orders
    }));

    res.json({
      success: true,
      period,
      data: formattedData
    });
  } catch (err) {
    console.error('Sales analytics error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sales analytics'
    });
  }
});

// Get inventory analytics
router.get('/inventory-analytics', async (req, res) => {
  try {
    const db = getDB();
    
    // Products by category
    const productsByCategory = await db.collection('products').aggregate([
      {
        $lookup: {
          from: 'categories',
          localField: 'category_id',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$category.name',
          count: { $sum: 1 },
          total_value: { $sum: { $multiply: ['$price', '$stock_quantity'] } }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    // Stock value distribution
    const stockValueDistribution = await db.collection('products').aggregate([
      {
        $group: {
          _id: null,
          total_value: { $sum: { $multiply: ['$price', '$stock_quantity'] } },
          total_items: { $sum: '$stock_quantity' },
          avg_price: { $avg: '$price' }
        }
      }
    ]).toArray();
    
    res.json({
      success: true,
      productsByCategory,
      stockValueDistribution: stockValueDistribution[0] || {
        total_value: 0,
        total_items: 0,
        avg_price: 0
      }
    });
  } catch (err) {
    console.error('Inventory analytics error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory analytics'
    });
  }
});

// Sales report export
router.get('/sales-report/export', async (req, res) => {
  const { start_date, end_date, format = 'pdf' } = req.query;
  try {
    const db = getDB();
    let query = {};
    if (start_date || end_date) {
      query.createdAt = {};
      if (start_date) query.createdAt.$gte = new Date(start_date);
      if (end_date) query.createdAt.$lte = new Date(end_date);
    }
    
    const orders = await db.collection('orders').find(query).toArray();
    const totalSales = orders.reduce((sum, o) => sum + (o.final_amount || 0), 0);
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders ? totalSales / totalOrders : 0;
    
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sales Report');
      
      // Header
      sheet.addRow(['RTQ Foods - Sales Report']);
      sheet.addRow([`Period: ${start_date || 'All'} to ${end_date || 'Now'}`]);
      sheet.addRow([]);
      
      // Summary
      sheet.addRow(['Summary']);
      sheet.addRow(['Total Sales', totalSales]);
      sheet.addRow(['Total Orders', totalOrders]);
      sheet.addRow(['Average Order Value', averageOrderValue]);
      sheet.addRow([]);
      
      // Orders details
      sheet.addRow(['Order Details']);
      sheet.addRow(['Order Number', 'Customer', 'Type', 'Amount', 'Status', 'Payment', 'Date']);
      orders.forEach(o => {
        const orderNumber = o._id ? o._id.toString().slice(-8) : 'N/A';
        const customerName = o.delivery_details?.fullName || o.customer_name || 'N/A';
        const orderType = o.order_type || 'Online';
        const amount = o.final_amount || o.amount || 0;
        const status = o.status || 'Unknown';
        const paymentType = o.payment_type || 'Online';
        const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'N/A';
        sheet.addRow([
          orderNumber,
          customerName,
          orderType,
          amount,
          status,
          paymentType,
          date
        ]);
      });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=rtq-sales-report.xlsx');
      await workbook.xlsx.write(res);
      res.end();
    } else {
      try {
        const doc = new PDFDocument();
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          try {
            const pdfData = Buffer.concat(buffers);
            res.set({ 
              'Content-Type': 'application/pdf', 
              'Content-Disposition': 'attachment; filename=rtq-sales-report.pdf',
              'Content-Length': pdfData.length
            });
            res.send(pdfData);
          } catch (err) {
            console.error('Error sending PDF:', err);
            res.status(500).json({ success: false, message: 'Failed to send PDF' });
          }
        });
        
        doc.on('error', (err) => {
          console.error('PDF generation error:', err);
          res.status(500).json({ success: false, message: 'Failed to generate PDF' });
        });
        
        // PDF content
        doc.fontSize(20).text('RTQ Foods', { align: 'center' });
        doc.fontSize(16).text('Sales Report', { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(12).text(`Period: ${start_date || 'All'} to ${end_date || 'Now'}`);
        doc.text(`Total Sales: ₹${totalSales.toFixed(2)}`);
        doc.text(`Total Orders: ${totalOrders}`);
        doc.text(`Average Order Value: ₹${averageOrderValue.toFixed(2)}`);
        doc.moveDown();
        
        doc.text('Recent Orders:');
        doc.text('----------------------------------------');
        
        // Simple test first
        doc.text('Test Order | Test Customer | ₹100 | Pending | 2025-07-28');
        
        if (orders.length > 0) {
          orders.slice(0, 20).forEach(o => {
            const orderNumber = o._id ? o._id.toString().slice(-8) : 'N/A';
            const customerName = o.delivery_details?.fullName || o.customer_name || 'N/A';
            const amount = o.final_amount || o.amount || 0;
            const status = o.status || 'Unknown';
            const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString() : 'N/A';
            doc.text(`${orderNumber} | ${customerName} | ₹${amount} | ${status} | ${date}`);
          });
        } else {
          doc.text('No orders found');
        }
        
        doc.end();
      } catch (err) {
        console.error('PDF generation error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate PDF' });
      }
    }
  } catch (err) {
    console.error('Sales report export error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate sales report' });
  }
});

// Inventory report export
router.get('/inventory-report/export', async (req, res) => {
  const { format = 'pdf' } = req.query;
  try {
    const db = getDB();
    
    const products = await db.collection('products').aggregate([
      {
        $lookup: {
          from: 'categories',
          localField: 'category_id',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: 1,
          category_name: '$category.name',
          price: { $toDouble: '$price' },
          stock_quantity: { $toInt: '$stock_quantity' },
          low_stock_threshold: { $toInt: '$low_stock_threshold' },
          stock_value: { 
            $multiply: [
              { $toDouble: '$price' }, 
              { $toInt: '$stock_quantity' }
            ] 
          },
          status: {
            $cond: {
              if: { 
                $lte: [
                  { $toInt: '$stock_quantity' }, 
                  { $toInt: '$low_stock_threshold' }
                ] 
              },
              then: 'Low Stock',
              else: 'In Stock'
            }
          }
        }
      },
      { $sort: { category_name: 1, name: 1 } }
    ]).toArray();
    
    const totalValue = products.reduce((sum, p) => sum + p.stock_value, 0);
    const lowStockCount = products.filter(p => p.status === 'Low Stock').length;
    
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Inventory Report');
      
      // Header
      sheet.addRow(['RTQ Foods - Inventory Report']);
      sheet.addRow([`Generated on: ${new Date().toLocaleDateString()}`]);
      sheet.addRow([]);
      
      // Summary
      sheet.addRow(['Summary']);
      sheet.addRow(['Total Products', products.length]);
      sheet.addRow(['Total Stock Value', totalValue]);
      sheet.addRow(['Low Stock Items', lowStockCount]);
      sheet.addRow([]);
      
      // Products details
      sheet.addRow(['Product Details']);
      sheet.addRow(['Name', 'Category', 'Price', 'Stock', 'Threshold', 'Stock Value', 'Status']);
      products.forEach(p => {
        const name = p.name || 'N/A';
        const category = p.category_name || 'N/A';
        const price = p.price || 0;
        const stock = p.stock_quantity || 0;
        const threshold = p.low_stock_threshold || 0;
        const value = p.stock_value || 0;
        const status = p.status || 'Unknown';
        sheet.addRow([
          name,
          category,
          price,
          stock,
          threshold,
          value,
          status
        ]);
      });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=rtq-inventory-report.xlsx');
      await workbook.xlsx.write(res);
      res.end();
    } else {
      try {
        const doc = new PDFDocument();
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          try {
            const pdfData = Buffer.concat(buffers);
            res.set({ 
              'Content-Type': 'application/pdf', 
              'Content-Disposition': 'attachment; filename=rtq-inventory-report.pdf',
              'Content-Length': pdfData.length
            });
            res.send(pdfData);
          } catch (err) {
            console.error('Error sending Inventory PDF:', err);
            res.status(500).json({ success: false, message: 'Failed to send Inventory PDF' });
          }
        });
        
        doc.on('error', (err) => {
          console.error('Inventory PDF generation error:', err);
          res.status(500).json({ success: false, message: 'Failed to generate Inventory PDF' });
        });
        
        // PDF content
        doc.fontSize(20).text('RTQ Foods', { align: 'center' });
        doc.fontSize(16).text('Inventory Report', { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`);
        doc.text(`Total Products: ${products.length}`);
        doc.text(`Total Stock Value: ₹${totalValue.toFixed(2)}`);
        doc.text(`Low Stock Items: ${lowStockCount}`);
        doc.moveDown();
        
        doc.text('Products:');
        doc.text('----------------------------------------');
        
        // Add debug logging        
        if (products.length > 0) {
          products.forEach(p => {
            const name = p.name || 'N/A';
            const category = p.category_name || 'N/A';
            const price = p.price || 0;
            const stock = p.stock_quantity || 0;
            const value = p.stock_value || 0;
            const status = p.status || 'Unknown';
            doc.text(`${name} | ${category} | ₹${price} | Stock: ${stock} | Value: ₹${value.toFixed(2)} | ${status}`);
          });
        } else {
          doc.text('No products found');
        }
        
        doc.end();
      } catch (err) {
        console.error('Inventory PDF generation error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate Inventory PDF' });
      }
    }
  } catch (err) {
    console.error('Inventory report export error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate inventory report' });
  }
});

module.exports = router; 