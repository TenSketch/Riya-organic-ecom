const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../models/db');
const shiprocketService = require('../services/shiprocketService');
const jwt = require('jsonwebtoken');

// Auth middleware
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

/**
 * Create shipment for an order
 * POST /shipments/create
 */
router.post('/create', authMiddleware(['admin']), async (req, res) => {
  try {
    const { orderId } = req.body;
    const db = getDB();

    // Get order from database
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if shipment already exists for this order
    const existingShipment = await db.collection('shipments').findOne({ order_id: order._id });
    if (existingShipment && existingShipment.shiprocket_shipment_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Shipment already created for this order',
        shipment_id: existingShipment.shiprocket_shipment_id
      });
    }

    // Parse address
    const addressParts = order.customer_address.split(', ');
    const shipmentData = {
      order_id: order._id.toString(),
      order_date: order.createdAt,
      customer_name: order.customer_name.split(' ')[0],
      customer_last_name: order.customer_name.split(' ').slice(1).join(' '),
      customer_phone: order.customer_contact,
      customer_email: order.customer_email,
      customer_address: addressParts[0] || order.customer_address,
      customer_city: addressParts[1] || 'Unknown',
      customer_state: addressParts[2] || 'Unknown',
      customer_pincode: addressParts[3] || '000000',
      customer_country: 'India',
      payment_method: order.payment_type || 'Prepaid',
      subtotal: order.total_amount,
      order_items: order.items.map(item => ({
        name: item.product_name,
        sku: item.product_id.toString(),
        units: item.quantity,
        selling_price: item.price,
        discount: 0,
        tax: 0,
        hsn_code: ''
      })),
      weight: 1,
      length: 10,
      breadth: 10,
      height: 10
    };

    // Create shipment on Shiprocket
    const shipmentResponse = await shiprocketService.createShipment(shipmentData);

    if (shipmentResponse.success) {
      // Save shipment details to database
      const shipmentRecord = {
        order_id: order._id,
        shiprocket_shipment_id: shipmentResponse.shipment_id,
        shiprocket_order_id: shipmentResponse.order_id,
        customer_email: order.customer_email,
        customer_phone: order.customer_contact,
        shipment_details: shipmentResponse.data,
        awb: shipmentResponse.data.awb_code || null,
        status: 'PENDING',
        created_at: new Date(),
        updated_at: new Date()
      };

      await db.collection('shipments').insertOne(shipmentRecord);

      // Update order with shipment status
      await db.collection('orders').updateOne(
        { _id: order._id },
        {
          $set: {
            delivery_status: 'Confirmed',
            shiprocket_shipment_id: shipmentResponse.shipment_id,
            updated_at: new Date()
          }
        }
      );

      return res.json({
        success: true,
        message: 'Shipment created successfully',
        shipment_id: shipmentResponse.shipment_id,
        order_id: order._id.toString(),
        data: shipmentResponse.data
      });
    }
  } catch (error) {
    console.error('Create shipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create shipment'
    });
  }
});

/**
 * Get shipment tracking details
 * GET /shipments/track/:shipmentId
 */
router.get('/track/:shipmentId', async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const db = getDB();

    // Get shipment from database
    const shipment = await db.collection('shipments').findOne({
      shiprocket_shipment_id: parseInt(shipmentId)
    });

    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }

    // Get tracking from Shiprocket
    const tracking = await shiprocketService.getShipmentTracking(shipmentId);

    if (tracking.success) {
      const orderStatus = shiprocketService.mapStatusToOrderStatus(tracking.status);

      // Update shipment and order status in database
      await db.collection('shipments').updateOne(
        { _id: shipment._id },
        {
          $set: {
            status: tracking.status,
            awb: tracking.awb,
            tracking_data: tracking.tracking_data,
            updated_at: new Date()
          }
        }
      );

      await db.collection('orders').updateOne(
        { _id: shipment.order_id },
        {
          $set: {
            delivery_status: orderStatus,
            delivery_tracking_link: `https://track.shiprocket.in/${tracking.awb}`,
            updated_at: new Date()
          }
        }
      );

      return res.json({
        success: true,
        shipment_id: shipmentId,
        tracking: tracking,
        order_status: orderStatus
      });
    }
  } catch (error) {
    console.error('Track shipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get tracking information'
    });
  }
});

/**
 * Get order tracking details
 * GET /shipments/track-order/:orderId
 */
router.get('/track-order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const db = getDB();

    // Get order from database
    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Get tracking from Shiprocket
    const tracking = await shiprocketService.getOrderTracking(order._id.toString());

    if (tracking.success && tracking.shipments.length > 0) {
      const shipmentInfo = tracking.shipments[0];
      const orderStatus = shiprocketService.mapStatusToOrderStatus(shipmentInfo.shipment_status);

      return res.json({
        success: true,
        order_id: orderId,
        shipments: tracking.shipments,
        current_status: orderStatus,
        awb: shipmentInfo.awb
      });
    } else {
      return res.json({
        success: false,
        message: 'No shipment found for this order',
        order_id: orderId
      });
    }
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get order tracking'
    });
  }
});

/**
 * Cancel shipment
 * POST /shipments/cancel/:shipmentId
 */
router.post('/cancel/:shipmentId', authMiddleware(['admin']), async (req, res) => {
  try {
    const { shipmentId } = req.params;
    const db = getDB();

    // Get shipment from database
    const shipment = await db.collection('shipments').findOne({
      shiprocket_shipment_id: parseInt(shipmentId)
    });

    if (!shipment) {
      return res.status(404).json({ success: false, message: 'Shipment not found' });
    }

    // Cancel on Shiprocket
    const cancelResponse = await shiprocketService.cancelShipment(shipmentId);

    if (cancelResponse.success) {
      // Update shipment status
      await db.collection('shipments').updateOne(
        { _id: shipment._id },
        {
          $set: {
            status: 'CANCELLED',
            updated_at: new Date()
          }
        }
      );

      // Update order status
      await db.collection('orders').updateOne(
        { _id: shipment.order_id },
        {
          $set: {
            delivery_status: 'Cancelled',
            updated_at: new Date()
          }
        }
      );

      return res.json({
        success: true,
        message: 'Shipment cancelled successfully',
        shipment_id: shipmentId
      });
    }
  } catch (error) {
    console.error('Cancel shipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to cancel shipment'
    });
  }
});

/**
 * Get pickup locations
 * GET /shipments/pickup-locations
 */
router.get('/pickup-locations', authMiddleware(['admin']), async (req, res) => {
  try {
    const locations = await shiprocketService.getPickupLocations();

    if (locations.success) {
      return res.json({
        success: true,
        locations: locations.locations
      });
    }
  } catch (error) {
    console.error('Get pickup locations error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to get pickup locations'
    });
  }
});

/**
 * Get all shipments
 * GET /shipments
 */
router.get('/', authMiddleware(['admin']), async (req, res) => {
  try {
    const db = getDB();

    const shipments = await db.collection('shipments')
      .aggregate([
        {
          $lookup: {
            from: 'orders',
            localField: 'order_id',
            foreignField: '_id',
            as: 'order'
          }
        },
        { $unwind: '$order' },
        { $sort: { created_at: -1 } }
      ])
      .toArray();

    res.json({
      success: true,
      shipments: shipments
    });
  } catch (error) {
    console.error('Get shipments error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get shipments'
    });
  }
});

/**
 * Get shipment details by order ID
 * GET /shipments/order/:orderId
 */
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const db = getDB();

    const shipment = await db.collection('shipments').findOne({
      order_id: new ObjectId(orderId)
    });

    if (!shipment) {
      return res.status(404).json({ 
        success: false, 
        message: 'No shipment found for this order'
      });
    }

    res.json({
      success: true,
      shipment: shipment
    });
  } catch (error) {
    console.error('Get order shipment error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get shipment details'
    });
  }
});

module.exports = router;
