const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/authMiddleware');
const OtpCode = require('../models/OtpCode');
const { sendOtpEmail } = require('../services/emailService');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// OTP generation removed

// send-otp route removed

// verify-otp route removed

// @route   POST /auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { username, email, password, languagePref } = req.body;

    // Check if user already exists
    const existingUser = await User.findByEmailOrUsername(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or username'
      });
    }

    // Create new user
    const user = new User({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      languagePref: languagePref || 'en'
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Return user data (without password)
    const userData = user.getPublicProfile();

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: userData,
        token
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @route   POST /auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('identifier')
    .notEmpty()
    .withMessage('Email or username is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { identifier, password } = req.body;

    // Find user by email or username
    const user = await User.findByEmailOrUsername(identifier);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresInMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    // Save OTP
    await OtpCode.create({
      userId: user._id,
      email: user.email,
      code: otp,
      expiresAt,
      used: false,
      attempts: 0
    });

    // Send OTP via email
    try {
      await sendOtpEmail(user.email, otp);
    } catch (emailErr) {
      console.error('Failed to send OTP email:', emailErr);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code. Please try again later.'
      });
    }

    res.json({
      success: true,
      message: 'Verification code sent to your email',
      data: {
        otpPending: true,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @route   POST /auth/verify-otp
// @desc    Verify OTP and issue JWT
// @access  Public
router.post('/verify-otp', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, code } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid verification request' });
    }

    const otpRecord = await OtpCode.findOne({
      userId: user._id,
      email: user.email,
      code,
      used: false,
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      // Increment attempts on the latest record for rate limiting/hardening
      await OtpCode.findOneAndUpdate({ userId: user._id }, { $inc: { attempts: 1 } }, { sort: { createdAt: -1 } });
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    // Mark OTP as used
    otpRecord.used = true;
    await otpRecord.save();

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Issue JWT and return user profile
    const token = generateToken(user._id);
    const userData = user.getPublicProfile();

    res.json({
      success: true,
      message: 'Verification successful',
      data: {
        user: userData,
        token
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error during verification' });
  }
});

// @route   POST /auth/refresh
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    // Generate new token
    const token = generateToken(req.user._id);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during token refresh'
    });
  }
});

// @route   POST /auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    // In a more advanced implementation, you might want to blacklist the token
    // For now, we'll just send a success response
    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
});

// @route   GET /auth/verify
// @desc    Verify JWT token and get user data
// @access  Private
router.get('/verify', authMiddleware, async (req, res) => {
  try {
    const userData = req.user.getPublicProfile();

    res.json({
      success: true,
      message: 'Token is valid',
      data: {
        user: userData
      }
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during token verification'
    });
  }
});

module.exports = router;