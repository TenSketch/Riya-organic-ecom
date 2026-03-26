require('dotenv').config();
const { connectDB } = require('./models/db');
const bcrypt = require('bcrypt');

async function createAdminUser() {
  try {
    const db = await connectDB();
    
    // Check if admin user already exists
    const existingUser = await db.collection('users').findOne({ email: 'admin@example.com' });
    
    if (existingUser) {
      console.log('Admin user already exists');
      console.log('Existing user:', existingUser);
      return;
    }
    
    // Create admin user with proper structure
    const password_hash = await bcrypt.hash('admin123', 10);
    
    const adminUser = {
      name: 'Admin',
      email: 'admin@example.com',
      password_hash: password_hash,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('Creating admin user with structure:', adminUser);
    
    const result = await db.collection('users').insertOne(adminUser);
    
    console.log('Admin user created successfully with ID:', result.insertedId);
    console.log('Admin credentials: admin@example.com / admin123');
    
    // Verify the user was created
    const createdUser = await db.collection('users').findOne({ email: 'admin@example.com' });
    console.log('Created user in database:', createdUser);
    
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
}

createAdminUser(); 