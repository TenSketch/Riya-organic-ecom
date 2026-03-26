const axios = require('axios');

class ShiprocketService {
  constructor() {
    this.baseURL = process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in/v1/external';
    this.token = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with Shiprocket API and get access token
   */
  async authenticate() {
    try {
      // Check if we have a valid cached token
      if (this.token && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.token;
      }

      const response = await axios.post(`${this.baseURL}/auth/login`, {
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD
      });

      if (response.data && response.data.token) {
        this.token = response.data.token;
        // Set expiry to 24 hours from now
        this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
        return this.token;
      } else {
        throw new Error('Invalid authentication response from Shiprocket');
      }
    } catch (error) {
      console.error('Shiprocket authentication error:', error.response?.data || error.message);
      throw new Error(`Shiprocket authentication failed: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get authorization headers
   */
  async getHeaders() {
    const token = await this.authenticate();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Create a shipment for an order
   * @param {Object} shipmentData - Order and customer data
   */
  async createShipment(shipmentData) {
    try {
      const headers = await this.getHeaders();

      const payload = {
        order_id: shipmentData.order_id,
        order_date: shipmentData.order_date || new Date().toISOString(),
        pickup_location_id: shipmentData.pickup_location_id || 1,
        channel_id: shipmentData.channel_id || 1,
        comment: shipmentData.comment || '',
        billing_customer_name: shipmentData.customer_name,
        billing_last_name: shipmentData.customer_last_name || '',
        billing_phone: shipmentData.customer_phone,
        billing_email: shipmentData.customer_email,
        billing_address: shipmentData.customer_address,
        billing_city: shipmentData.customer_city,
        billing_state: shipmentData.customer_state,
        billing_country: shipmentData.customer_country || 'India',
        billing_pincode: shipmentData.customer_pincode,
        shipping_is_default: true,
        shipping_customer_name: shipmentData.customer_name,
        shipping_last_name: shipmentData.customer_last_name || '',
        shipping_phone: shipmentData.customer_phone,
        shipping_email: shipmentData.customer_email,
        shipping_address: shipmentData.customer_address,
        shipping_city: shipmentData.customer_city,
        shipping_state: shipmentData.customer_state,
        shipping_country: shipmentData.customer_country || 'India',
        shipping_pincode: shipmentData.customer_pincode,
        order_items: shipmentData.order_items,
        payment_method: shipmentData.payment_method || 'Prepaid',
        sub_total: shipmentData.subtotal,
        length: shipmentData.length || 10,
        breadth: shipmentData.breadth || 10,
        height: shipmentData.height || 10,
        weight: shipmentData.weight || 1
      };

      const response = await axios.post(`${this.baseURL}/orders/create/adhoc`, payload, { headers });

      if (response.data && response.data.shipment_id) {
        return {
          success: true,
          shipment_id: response.data.shipment_id,
          order_id: response.data.order_id,
          data: response.data
        };
      } else {
        throw new Error(response.data?.message || 'Failed to create shipment');
      }
    } catch (error) {
      console.error('Shipment creation error:', error.response?.data || error.message);
      throw new Error(`Failed to create shipment: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get shipment tracking details
   * @param {number} shipment_id - Shiprocket shipment ID
   */
  async getShipmentTracking(shipment_id) {
    try {
      const headers = await this.getHeaders();

      const response = await axios.get(
        `${this.baseURL}/shipments/track/shipment/${shipment_id}`,
        { headers }
      );

      if (response.data && response.data.tracking_data) {
        return {
          success: true,
          shipment_id: shipment_id,
          tracking_data: response.data.tracking_data,
          status: response.data.tracking_data.shipment_status,
          awb: response.data.tracking_data.awb
        };
      } else {
        throw new Error('Failed to get tracking information');
      }
    } catch (error) {
      console.error('Shipment tracking error:', error.response?.data || error.message);
      throw new Error(`Failed to get tracking info: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get order tracking details by order ID
   * @param {string} order_id - Order ID
   */
  async getOrderTracking(order_id) {
    try {
      const headers = await this.getHeaders();

      const response = await axios.get(
        `${this.baseURL}/shipments/track/order/${order_id}`,
        { headers }
      );

      if (response.data && response.data.shipments) {
        return {
          success: true,
          order_id: order_id,
          shipments: response.data.shipments
        };
      } else {
        throw new Error('Failed to get order tracking');
      }
    } catch (error) {
      console.error('Order tracking error:', error.response?.data || error.message);
      throw new Error(`Failed to get order tracking: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Cancel a shipment
   * @param {number} shipment_id - Shiprocket shipment ID
   */
  async cancelShipment(shipment_id) {
    try {
      const headers = await this.getHeaders();

      const response = await axios.post(
        `${this.baseURL}/shipments/cancel`,
        { shipment_id },
        { headers }
      );

      if (response.data && response.data.success) {
        return {
          success: true,
          message: response.data.message || 'Shipment cancelled successfully'
        };
      } else {
        throw new Error(response.data?.message || 'Failed to cancel shipment');
      }
    } catch (error) {
      console.error('Shipment cancellation error:', error.response?.data || error.message);
      throw new Error(`Failed to cancel shipment: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get pickup locations
   */
  async getPickupLocations() {
    try {
      const headers = await this.getHeaders();

      const response = await axios.get(
        `${this.baseURL}/settings/pickup`,
        { headers }
      );

      if (response.data && response.data.data) {
        return {
          success: true,
          locations: response.data.data
        };
      } else {
        throw new Error('Failed to get pickup locations');
      }
    } catch (error) {
      console.error('Pickup locations error:', error.response?.data || error.message);
      throw new Error(`Failed to get pickup locations: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Map Shiprocket status to order status
   * @param {string} shiprocket_status - Status from Shiprocket
   */
  mapStatusToOrderStatus(shiprocket_status) {
    const statusMap = {
      'PENDING': 'Pending',
      'PICKED': 'Picked',
      'DISPATCHED': 'Dispatched',
      'IN_TRANSIT': 'In Transit',
      'OUT_FOR_DELIVERY': 'Out for Delivery',
      'DELIVERED': 'Delivered',
      'CANCELLED': 'Cancelled',
      'RTO_INITIATED': 'Return Initiated',
      'RTO_IN_TRANSIT': 'Return in Transit',
      'RTO_DELIVERED': 'Returned',
      'LOST': 'Lost',
      'DAMAGED': 'Damaged'
    };

    return statusMap[shiprocket_status] || shiprocket_status;
  }
}

module.exports = new ShiprocketService();
