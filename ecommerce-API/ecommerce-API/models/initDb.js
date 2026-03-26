const { connectDB } = require('./db');
const bcrypt = require('bcrypt');

async function initializeDatabase() {
  try {
    // Connect to MongoDB
    const db = await connectDB();
    
    // Create default categories for RTQ Foods
    const categories = [
      { 
        name: 'HealthMix',
        description: 'Nutritious health mixes and powders',
        sort_order: 1
      },
      { 
        name: 'Spices',
        description: 'Premium quality spices and seasonings',
        sort_order: 2
      },
      { 
        name: 'Herbs',
        description: 'Medicinal and culinary herbs',
        sort_order: 3
      },
      { 
        name: 'Supplements',
        description: 'Health supplements and vitamins',
        sort_order: 4
      },
      { 
        name: 'Organic Foods',
        description: 'Certified organic food products',
        sort_order: 5
      },
      { 
        name: 'Dry Fruits',
        description: 'Premium quality dry fruits and nuts',
        sort_order: 6
      },
      { 
        name: 'Ayurvedic Products',
        description: 'Traditional Ayurvedic formulations',
        sort_order: 7
      }
    ];

    for (const categoryData of categories) {
      await db.collection('categories').updateOne(
        { name: categoryData.name },
        { $set: categoryData },
        { upsert: true }
      );
    }

    // Create default admin user with hashed password
    const password_hash = await bcrypt.hash('admin123', 10);
    const adminUser = {
      name: 'RTQ Foods Admin',
      email: 'admin@rtqfoods.com',
      password_hash,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('users').updateOne(
      { email: adminUser.email },
      { $set: adminUser },
      { upsert: true }
    );

    // Create sample products
    const spicesCategory = await db.collection('categories').findOne({ name: 'Spices' });
    const healthMixCategory = await db.collection('categories').findOne({ name: 'HealthMix' });
    const herbsCategory = await db.collection('categories').findOne({ name: 'Herbs' });
    const dryFruitsCategory = await db.collection('categories').findOne({ name: 'Dry Fruits' });

    const sampleProducts = [
      {
        name: 'Organic Turmeric Powder',
        image_url: 'https://via.placeholder.com/300x200?text=Turmeric',
        category_id: spicesCategory._id,
        description: 'Pure organic turmeric powder with high curcumin content. Known for its anti-inflammatory properties.',
        price: 299.00,
        stock_quantity: 50,
        product_type: 'Both',
        visible: true,
        health_benefits: 'Anti-inflammatory, antioxidant, immune booster',
        ingredients: '100% Organic Turmeric',
        weight: 250,
        low_stock_threshold: 10,
        stockAdjustments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'RTQ Health Mix Powder',
        image_url: 'https://via.placeholder.com/300x200?text=HealthMix',
        category_id: healthMixCategory._id,
        description: 'Nutritious health mix with multiple grains, nuts, and seeds. Perfect for daily nutrition.',
        price: 450.00,
        stock_quantity: 30,
        product_type: 'Both',
        visible: true,
        health_benefits: 'High protein, fiber-rich, energy booster',
        ingredients: 'Oats, Almonds, Walnuts, Flax seeds, Chia seeds',
        weight: 500,
        low_stock_threshold: 15,
        stockAdjustments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Black Pepper Premium',
        image_url: 'https://via.placeholder.com/300x200?text=Pepper',
        category_id: spicesCategory._id,
        description: 'Premium quality black pepper with intense flavor and aroma.',
        price: 150.00,
        stock_quantity: 100,
        product_type: 'Both',
        visible: true,
        health_benefits: 'Digestive aid, antioxidant, metabolism booster',
        ingredients: '100% Black Pepper',
        weight: 100,
        low_stock_threshold: 20,
        stockAdjustments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Organic Cinnamon Powder',
        image_url: 'https://via.placeholder.com/300x200?text=Cinnamon',
        category_id: spicesCategory._id,
        description: 'Pure organic cinnamon powder with sweet and warm flavor.',
        price: 180.00,
        stock_quantity: 75,
        product_type: 'Both',
        visible: true,
        health_benefits: 'Blood sugar control, anti-inflammatory, antioxidant',
        ingredients: '100% Organic Cinnamon',
        weight: 100,
        low_stock_threshold: 15,
        stockAdjustments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Tulsi (Holy Basil) Powder',
        image_url: 'https://via.placeholder.com/300x200?text=Tulsi',
        category_id: herbsCategory._id,
        description: 'Traditional Tulsi powder known for its medicinal properties.',
        price: 220.00,
        stock_quantity: 40,
        product_type: 'Both',
        visible: true,
        health_benefits: 'Stress relief, immune booster, respiratory health',
        ingredients: '100% Tulsi Leaves',
        weight: 100,
        low_stock_threshold: 10,
        stockAdjustments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Premium Almonds',
        image_url: 'https://via.placeholder.com/300x200?text=Almonds',
        category_id: dryFruitsCategory._id,
        description: 'Premium quality almonds rich in nutrients and healthy fats.',
        price: 350.00,
        stock_quantity: 60,
        product_type: 'Both',
        visible: true,
        health_benefits: 'Heart health, brain function, skin health',
        ingredients: '100% Almonds',
        weight: 250,
        low_stock_threshold: 20,
        stockAdjustments: [],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    for (const productData of sampleProducts) {
      await db.collection('products').updateOne(
        { name: productData.name },
        { $set: productData },
        { upsert: true }
      );
    }
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = initializeDatabase; 