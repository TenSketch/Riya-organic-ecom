const { getDB, connectDB } = require('./models/db');
const { ObjectId } = require('mongodb');

const sampleProducts = [
  {
    name: "Organic Turmeric Powder",
    description: "Pure organic turmeric powder with high curcumin content. Perfect for cooking and health benefits.",
    price: 299,
    category_id: new ObjectId("687b4d1cb50cff98b1092fd0"), // Spices category
    image_url: "https://via.placeholder.com/300x200/4CAF50/FFFFFF?text=Organic+Turmeric",
    stock_quantity: 50,
    product_type: "Online",
    visible: true,
    health_benefits: "Anti-inflammatory, antioxidant properties",
    ingredients: "100% Organic Turmeric",
    weight: "250g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Superfood Health Mix",
    description: "Nutrient-rich blend of organic grains, nuts, and seeds for daily nutrition boost.",
    price: 450,
    category_id: new ObjectId("687b4d1cb50cff98b1092fce"), // HealthMix category
    image_url: "https://via.placeholder.com/300x200/FF9800/FFFFFF?text=Health+Mix",
    stock_quantity: 30,
    product_type: "Online",
    visible: true,
    health_benefits: "Rich in nutrients, energy boost",
    ingredients: "Organic grains, nuts, seeds",
    weight: "500g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Premium Black Pepper",
    description: "Hand-picked premium black pepper with intense flavor and aroma. Perfect for all cuisines.",
    price: 180,
    category_id: new ObjectId("687b4d1cb50cff98b1092fd0"), // Spices category
    image_url: "https://via.placeholder.com/300x200/2196F3/FFFFFF?text=Black+Pepper",
    stock_quantity: 75,
    product_type: "Online",
    visible: true,
    health_benefits: "Digestive aid, antioxidant",
    ingredients: "100% Black Pepper",
    weight: "100g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Organic Cinnamon Powder",
    description: "Pure organic cinnamon powder with sweet and warm flavor. Great for baking and beverages.",
    price: 220,
    category_id: new ObjectId("687b4d1cb50cff98b1092fd0"), // Spices category
    image_url: "https://via.placeholder.com/300x200/8D6E63/FFFFFF?text=Cinnamon",
    stock_quantity: 40,
    product_type: "Online",
    visible: true,
    health_benefits: "Blood sugar regulation, anti-inflammatory",
    ingredients: "100% Organic Cinnamon",
    weight: "100g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Protein Rich Mix",
    description: "High-protein blend of lentils, quinoa, and nuts for muscle building and energy.",
    price: 380,
    category_id: new ObjectId("687b4d1cb50cff98b1092fce"), // HealthMix category
    image_url: "https://via.placeholder.com/300x200/795548/FFFFFF?text=Protein+Mix",
    stock_quantity: 25,
    product_type: "Online",
    visible: true,
    health_benefits: "High protein, muscle building",
    ingredients: "Lentils, quinoa, nuts",
    weight: "500g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Organic Cardamom",
    description: "Premium organic cardamom pods with intense aromatic flavor. Perfect for tea and desserts.",
    price: 320,
    category_id: new ObjectId("687b4d1cb50cff98b1092fd0"), // Spices category
    image_url: "https://via.placeholder.com/300x200/4CAF50/FFFFFF?text=Cardamom",
    stock_quantity: 35,
    product_type: "Online",
    visible: true,
    health_benefits: "Digestive health, breath freshener",
    ingredients: "100% Organic Cardamom",
    weight: "50g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Energy Boost Mix",
    description: "Natural energy blend with dates, nuts, and seeds. Perfect for pre-workout nutrition.",
    price: 420,
    category_id: new ObjectId("687b4d1cb50cff98b1092fce"), // HealthMix category
    image_url: "https://via.placeholder.com/300x200/FF9800/FFFFFF?text=Energy+Mix",
    stock_quantity: 20,
    product_type: "Online",
    visible: true,
    health_benefits: "Natural energy, pre-workout",
    ingredients: "Dates, nuts, seeds",
    weight: "400g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    name: "Organic Ginger Powder",
    description: "Pure organic ginger powder with strong anti-inflammatory properties. Great for tea and cooking.",
    price: 250,
    category_id: new ObjectId("687b4d1cb50cff98b1092fd0"), // Spices category
    image_url: "https://via.placeholder.com/300x200/FF5722/FFFFFF?text=Ginger",
    stock_quantity: 45,
    product_type: "Online",
    visible: true,
    health_benefits: "Anti-inflammatory, digestive aid",
    ingredients: "100% Organic Ginger",
    weight: "200g",
    low_stock_threshold: 10,
    stockAdjustments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

async function insertProducts() {
  try {
    await connectDB();
    const db = getDB();
    
    // Clear existing products
    await db.collection('products').deleteMany({});
    
    // Insert new products
    const result = await db.collection('products').insertMany(sampleProducts);    
    // Display inserted products
    const products = await db.collection('products').find({}).toArray();
    products.forEach(product => {
      console.log(`- ${product.name}: ₹${product.price} (${product.stock_quantity} in stock)`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error inserting products:', error);
    process.exit(1);
  }
}

insertProducts(); 