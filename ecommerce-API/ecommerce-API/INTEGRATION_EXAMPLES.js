/**
 * INTEGRATION GUIDE: Adding Shiprocket to Existing Orders Flow
 * 
 * This file shows how to integrate Shiprocket into your existing orders.js route
 * Copy these snippets and add them to the appropriate places in your orders route
 */

// ============================================================================
// STEP 1: Add this near the top of orders.js (after other require statements)
// ============================================================================

const shiprocketService = require('../services/shiprocketService');

// ============================================================================
// STEP 2: Add this after order payment verification (around line 260)
// ============================================================================

// After successful Razorpay payment verification, update the order creation:
// Previous code: status: 'Confirmed'
// New code:

const updatedOrderFields = {
  payment_status: 'Paid',
  status: 'Confirmed',
  delivery_status: 'Pending',  // ← ADD THIS
  delivery_tracking_link: '',  // ← ADD THIS
  updatedAt: new Date()
};

await db.collection('orders').updateOne(
  { _id: new ObjectId(orderId) },
  { $set: updatedOrderFields }
);

// ============================================================================
// STEP 3: Add new endpoint to create shipment (add to orders.js routes)
// ============================================================================

/**
 * Auto-create shipment after payment verification
 * This can be called automatically or manually from admin dashboard
 */
router.post('/create-shipment', authMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const { orderId } = req.body;
    const db = getDB();

    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if shipment already created
    if (order.shiprocket_shipment_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Shipment already created for this order' 
      });
    }

    // Parse address
    const addressParts = order.customer_address.split(', ');
    
    const shipmentData = {
      order_id: order._id.toString(),
      order_date: order.createdAt,
      customer_name: order.customer_name.split(' ')[0] || 'Customer',
      customer_last_name: order.customer_name.split(' ').slice(1).join(' ') || '',
      customer_phone: order.customer_contact,
      customer_email: order.customer_email,
      customer_address: addressParts[0] || order.customer_address,
      customer_city: addressParts[1] || 'City',
      customer_state: addressParts[2] || 'State',
      customer_pincode: addressParts[3] || '000000',
      customer_country: 'India',
      payment_method: order.payment_type || 'Prepaid',
      subtotal: order.total_amount,
      order_items: order.items.map(item => ({
        name: item.product_name || 'Product',
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

    // Create shipment with Shiprocket
    const shipmentResult = await shiprocketService.createShipment(shipmentData);

    if (shipmentResult.success) {
      // Save to shipments collection
      const shipmentRecord = {
        order_id: order._id,
        shiprocket_shipment_id: shipmentResult.shipment_id,
        shiprocket_order_id: shipmentResult.order_id,
        customer_email: order.customer_email,
        customer_phone: order.customer_contact,
        shipment_details: shipmentResult.data,
        awb: shipmentResult.data.awb_code || null,
        status: 'PENDING',
        created_at: new Date(),
        updated_at: new Date()
      };

      await db.collection('shipments').insertOne(shipmentRecord);

      // Update order with shipment info
      await db.collection('orders').updateOne(
        { _id: order._id },
        {
          $set: {
            delivery_status: 'Confirmed',
            shiprocket_shipment_id: shipmentResult.shipment_id,
            updatedAt: new Date()
          }
        }
      );

      res.json({
        success: true,
        message: 'Shipment created successfully',
        shipment_id: shipmentResult.shipment_id,
        data: shipmentResult.data
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: shipmentResult.message || 'Failed to create shipment'
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

// ============================================================================
// STEP 4: Add endpoint to get order status with tracking (add to orders.js)
// ============================================================================

/**
 * Get order with tracking information
 */
router.get('/:id/with-tracking', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();

    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    let trackingInfo = null;

    // If order has a shipment, get tracking details
    if (order.shiprocket_shipment_id) {
      try {
        const tracking = await shiprocketService.getShipmentTracking(order.shiprocket_shipment_id);
        if (tracking.success) {
          trackingInfo = {
            shipment_id: order.shiprocket_shipment_id,
            status: tracking.status,
            awb: tracking.awb,
            tracking_link: `https://track.shiprocket.in/${tracking.awb}`,
            tracking_data: tracking.tracking_data
          };

          // Update order status if changed
          const newOrderStatus = shiprocketService.mapStatusToOrderStatus(tracking.status);
          if (newOrderStatus !== order.delivery_status) {
            await db.collection('orders').updateOne(
              { _id: order._id },
              {
                $set: {
                  delivery_status: newOrderStatus,
                  delivery_tracking_link: `https://track.shiprocket.in/${tracking.awb}`,
                  updatedAt: new Date()
                }
              }
            );
            order.delivery_status = newOrderStatus;
            order.delivery_tracking_link = `https://track.shiprocket.in/${tracking.awb}`;
          }
        }
      } catch (error) {
        console.log('Could not fetch live tracking:', error.message);
        // Use saved tracking link if available
        trackingInfo = {
          shipment_id: order.shiprocket_shipment_id,
          status: order.delivery_status,
          tracking_link: order.delivery_tracking_link || '#'
        };
      }
    }

    res.json({
      success: true,
      order: {
        ...order,
        tracking: trackingInfo
      }
    });
  } catch (error) {
    console.error('Get order with tracking error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get order'
    });
  }
});

// ============================================================================
// STEP 5: Update the order list to include delivery status (add to orders.js)
// ============================================================================

/**
 * Get orders with shipment info (for dashboard)
 */
router.get('/admin/list', authMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const db = getDB();

    const orders = await db.collection('orders')
      .aggregate([
        {
          $lookup: {
            from: 'shipments',
            localField: '_id',
            foreignField: 'order_id',
            as: 'shipment'
          }
        },
        {
          $unwind: {
            path: '$shipment',
            preserveNullAndEmptyArrays: true
          }
        },
        { $sort: { createdAt: -1 } }
      ])
      .toArray();

    res.json({
      success: true,
      orders: orders
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get orders'
    });
  }
});

// ============================================================================
// STEP 6: Add webhook handler for Shiprocket updates (optional)
// ============================================================================

/**
 * Webhook endpoint for Shiprocket to send status updates
 * Configure in Shiprocket dashboard: Settings → Webhook
 * Webhook URL: https://yourdomain.com/api/orders/webhook/shiprocket
 */
router.post('/webhook/shiprocket', async (req, res) => {
  try {
    const { shipment_id, status, awb, timestamp } = req.body;

    const db = getDB();

    // Find and update shipment
    const shipment = await db.collection('shipments').findOne({
      shiprocket_shipment_id: parseInt(shipment_id)
    });

    if (shipment) {
      const orderStatus = shiprocketService.mapStatusToOrderStatus(status);

      // Update shipment
      await db.collection('shipments').updateOne(
        { _id: shipment._id },
        {
          $set: {
            status: status,
            awb: awb,
            updated_at: new Date(timestamp)
          }
        }
      );

      // Update order
      await db.collection('orders').updateOne(
        { _id: shipment.order_id },
        {
          $set: {
            delivery_status: orderStatus,
            delivery_tracking_link: `https://track.shiprocket.in/${awb}`,
            updatedAt: new Date()
          }
        }
      );
    }

    res.json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
});

// ============================================================================
// STEP 7: Frontend Integration Example
// ============================================================================

/*
// In your OrderManagement.jsx or similar:

import React, { useState, useEffect } from 'react';

function OrderManagement() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    const response = await fetch('/api/orders/admin/list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    setOrders(data.orders);
  };

  const createShipment = async (orderId) => {
    try {
      const response = await fetch('/api/orders/create-shipment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ orderId })
      });
      const data = await response.json();
      if (data.success) {
        alert('Shipment created: ' + data.shipment_id);
        fetchOrders(); // Refresh list
      } else {
        alert('Error: ' + data.message);
      }
    } catch (error) {
      alert('Failed: ' + error.message);
    }
  };

  return (
    <div>
      <h2>Orders</h2>
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Status</th>
            <th>Delivery Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <tr key={order._id}>
              <td>{order._id}</td>
              <td>{order.status}</td>
              <td>
                {order.delivery_status}
                {order.delivery_tracking_link && (
                  <a href={order.delivery_tracking_link} target="_blank">
                    Track
                  </a>
                )}
              </td>
              <td>
                {!order.shipment && (
                  <button onClick={() => createShipment(order._id)}>
                    Create Shipment
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default OrderManagement;
*/

// ============================================================================
// SUMMARY OF CHANGES REQUIRED
// ============================================================================

/*
1. Add require statement at top of orders.js
2. Update order payment verification to include delivery_status
3. Add POST /create-shipment endpoint
4. Add GET /:id/with-tracking endpoint
5. Add GET /admin/list endpoint with shipment lookup
6. Add POST /webhook/shiprocket endpoint (optional but recommended)
7. Update frontend to show shipment creation and tracking buttons
8. Test with sample order and verify shipment creation

Total Integration Time: 30-45 minutes
*/
