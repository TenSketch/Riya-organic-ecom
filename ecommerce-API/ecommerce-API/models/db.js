const { MongoClient } = require('mongodb');

let db = null;

const connectDB = async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
    await client.connect();

    // Use the database name 'RTQ' or default to 'ecommerce_db'
    db = client.db('RTQ');
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    console.warn('⚠️ Server is staying alive without a DB connection to allow debugging. Check your MONGODB_URI in .env');
    // process.exit(1); // Removed to prevent 503 errors and keep the server alive
  }
};

const getDB = () => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
};

module.exports = { connectDB, getDB }; 