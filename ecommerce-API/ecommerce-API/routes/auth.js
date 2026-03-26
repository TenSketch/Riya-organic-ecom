const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { getDB } = require('../models/db');
const { ObjectId } = require('mongodb');
const authMiddleware = require('../middleware/authMiddleware');

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ email });
    if (user) {
      console.log('User role:', user.role);
    }
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password_hash);    
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user._id.toString(), role: user.role }, 
      process.env.JWT_SECRET || 'secret', 
      { expiresIn: '1d' }
    );
        
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status || 'active',
        phone: user.phone || '',
        address: user.address || {}
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Signup
router.post('/signup', async (req, res) => {
  const { name, email, password, role = 'customer' } = req.body;
  try {
    const db = getDB();
    const existing = await db.collection('users').findOne({ email });
    
    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const password_hash = await bcrypt.hash(password, 10);
    const newUser = {
      name,
      email,
      password_hash,
      role,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('users').insertOne(newUser);
    newUser._id = result.insertedId;
    
    // If user is a customer, also create a customer record
    if (role === 'customer') {
      const customerData = {
        name: name,
        email: email,
        phone: '', // Will be filled later
        address: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: 'India'
        },
        user_id: newUser._id,
        total_orders: 0,
        total_spent: 0,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await db.collection('customers').insertOne(customerData);
    }
    
    res.json({
      success: true,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Forgot Password (mocked: generate reset token, log to console)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const db = getDB();
    const user = await db.collection('users').findOne({ email });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Generate a reset token and save it with an expiry (1 hour)
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { resetPasswordToken: resetToken, resetPasswordExpires: resetExpires } }
    );

    const appBase = process.env.APP_BASE_URL || 'http://localhost:3000';
    const resetUrl = `${appBase}/reset-password/${resetToken}`;

    // Try to send email if SMTP is configured, otherwise log the link
    try {
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: (process.env.SMTP_SECURE === 'true'),
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });

        const mailOpts = {
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: email,
          subject: 'Password Reset Request',
          text: `You requested a password reset. Use the link: ${resetUrl}. This link expires in 1 hour.`,
          html: `<p>You requested a password reset. Click the link below to set a new password (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
        };

        await transporter.sendMail(mailOpts);
      } else {
        console.log(`Password reset link for ${email}: ${resetUrl}`);
      }
    } catch (mailErr) {
      console.error('Error sending reset email:', mailErr);
      // do not fail the request because email failed; token is saved
    }

    res.json({ success: true, message: 'Password reset link sent (if email configured).' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Reset Password - accept new password using token
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: 'New password is required' });

  try {
    const db = getDB();
    const user = await db.collection('users').findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const password_hash = await require('bcrypt').hash(password, 10);

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { password_hash }, $unset: { resetPasswordToken: '', resetPasswordExpires: '' } }
    );

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// List all users (admin/staff only)
router.get('/users', authMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const db = getDB();
    const users = await db.collection('users').find({}).toArray();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create admin/staff user (admin only)
router.post('/users', authMiddleware(['admin']), async (req, res) => {
  try {
    const { name, email, password, role, status = 'active' } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    const db = getDB();
    const existing = await db.collection('users').findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }
    const password_hash = await require('bcrypt').hash(password, 10);
    const newUser = {
      name,
      email,
      password_hash,
      role,
      status,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('users').insertOne(newUser);
    newUser._id = result.insertedId;
    res.json({ success: true, user: { id: newUser._id, name, email, role, status } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update user (admin only)
router.patch('/users/:id', authMiddleware(['admin', 'customer']), async (req, res) => {
  try {
    const db = getDB();
    const { name, email, role, status, phone, address } = req.body;
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (status) updateData.status = status;
    if(phone) updateData.phone = phone;
    if(address) updateData.address = address;
    updateData.updatedAt = new Date();
    const result = await db.collection('users').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData },
      { returnDocument: 'after', projection: { password_hash: 0 } }
    );
    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, user: result.value });
  } catch (err) {
    console.error('User update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

// Delete user (admin only)
router.delete('/users/:id', authMiddleware(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('User deletion error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

module.exports = router; 