const { connectDB, getDB } = require('./db');

async function initShiprocketCollections() {
  try {
    console.log('Initializing Shiprocket collections...');
    const db = await connectDB();

    // Create shipments collection
    const collections = await db.listCollections().toArray();
    const shipmentCollectionExists = collections.some(col => col.name === 'shipments');

    if (!shipmentCollectionExists) {
      await db.createCollection('shipments');
      console.log('✓ Shipments collection created');

      // Create indexes for shipments collection
      await db.collection('shipments').createIndex({ order_id: 1 });
      await db.collection('shipments').createIndex({ shiprocket_shipment_id: 1 });
      await db.collection('shipments').createIndex({ created_at: -1 });
      await db.collection('shipments').createIndex({ status: 1 });
    } else {
      console.log('✓ Shipments collection already exists');
    }

    // Update orders collection to ensure delivery fields exist
    const ordersCollection = db.collection('orders');
    
    // Add missing fields to existing orders
    await ordersCollection.updateMany(
      { delivery_status: { $exists: false } },
      { 
        $set: { 
          delivery_status: 'Pending',
          delivery_tracking_link: ''
        }
      }
    );
    process.exit(0);
  } catch (error) {
    console.error('Error initializing Shiprocket collections:', error);
    process.exit(1);
  }
}

// Run initialization
initShiprocketCollections();
