require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./models/db');
const jwt = require('jsonwebtoken');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const dashboardRoutes = require('./routes/dashboard');
const categoryRoutes = require('./routes/categories');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const customerRoutes = require('./routes/customers');
const staticPagesRoutes = require('./routes/staticPages');
const cartRoutes = require('./routes/cart');
const shipmentRoutes = require('./routes/shipments');
const authMiddleware = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes); // Public access for products
app.use('/api/admin/products', authMiddleware(['admin', 'staff']), productRoutes); // Protected admin access
// Only protect /api/orders with admin/staff middleware
app.use('/api/orders', orderRoutes);
app.use('/api/customer/orders', authMiddleware(['customer']), orderRoutes); // Customer order routes
app.use('/api/dashboard', authMiddleware(['admin', 'staff']), dashboardRoutes);

// Public GET routes for categories
const publicCategoriesRouter = require('express').Router();
const categoryRoutesModule = require('./routes/categories');
publicCategoriesRouter.get('/', categoryRoutesModule.stack.find(r => r.route && r.route.path === '/' && r.route.methods.get).route.stack[0].handle);
publicCategoriesRouter.get('/:id', categoryRoutesModule.stack.find(r => r.route && r.route.path === '/:id' && r.route.methods.get).route.stack[0].handle);
app.use('/api/categories', publicCategoriesRouter);

// Protected category routes for admin/staff (POST, PUT, DELETE)
app.use('/api/admin/categories', authMiddleware(['admin', 'staff']), categoryRoutes);

app.use('/api/purchase-orders', authMiddleware(['admin', 'staff']), purchaseOrderRoutes);
app.use('/api/customers', authMiddleware(['admin', 'staff']), customerRoutes);
app.use('/api/customer/profile', authMiddleware(['customer']), customerRoutes); // Customer profile routes
app.use('/api/static-pages', staticPagesRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/shipments', shipmentRoutes);

// Test route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'RTQ Foods Backend is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});



app.listen(PORT, () => {
  console.log(`RTQ Foods Server is running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
