const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Upload = require('../models/Upload');
const Message = require('../models/Message');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// @route   GET /user/profile
// @desc    Get user profile
// @access  Private
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get user statistics
    const [uploadStats, chatStats] = await Promise.all([
      Upload.getAnalysisStats(req.user._id),
      Message.getChatStats(req.user._id)
    ]);

    const userData = user.getPublicProfile();
    userData.stats = {
      uploads: uploadStats[0] || {
        totalUploads: 0,
        healthyDetections: 0,
        diseaseDetections: 0,
        avgConfidence: 0
      },
      chat: chatStats[0] || {
        totalMessages: 0,
        totalSessions: 0,
        userMessages: 0,
        aiMessages: 0,
        avgResponseTime: 0
      }
    };

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: userData
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving profile'
    });
  }
});

// @route   PUT /user/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', [
  authMiddleware,
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please enter a valid email address'),
  body('languagePref')
    .optional()
    .isIn(['en', 'te', 'hi', 'es', 'fr'])
    .withMessage('Invalid language preference'),
  body('farmDetails.farmSize')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Farm size description too long'),
  body('farmDetails.location')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Location description too long'),
  body('farmDetails.primaryCrops')
    .optional()
    .isArray()
    .withMessage('Primary crops must be an array')
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

    const {
      username,
      email,
      languagePref,
      farmDetails,
      profilePic
    } = req.body;

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if username or email already exists (if being updated)
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username: username.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Username already exists'
        });
      }
      user.username = username.toLowerCase();
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      }
      user.email = email.toLowerCase();
    }

    // Update other fields
    if (languagePref) user.languagePref = languagePref;
    if (profilePic) user.profilePic = profilePic;
    
    if (farmDetails) {
      if (farmDetails.farmSize !== undefined) user.farmDetails.farmSize = farmDetails.farmSize;
      if (farmDetails.location !== undefined) user.farmDetails.location = farmDetails.location;
      if (farmDetails.primaryCrops !== undefined) user.farmDetails.primaryCrops = farmDetails.primaryCrops;
    }

    await user.save();

    const userData = user.getPublicProfile();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: userData
      }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
});

// @route   GET /user/dashboard
// @desc    Get user dashboard data
// @access  Private
router.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    // Get recent uploads
    const recentUploads = await Upload.getRecentUploads(req.user._id, 5);
    
    // Get recent chat sessions
    const recentSessions = await Message.getUserSessions(req.user._id, 5);
    
    // Get user statistics
    const [uploadStats, chatStats] = await Promise.all([
      Upload.getAnalysisStats(req.user._id),
      Message.getChatStats(req.user._id)
    ]);

    res.json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: {
        recentUploads,
        recentSessions,
        stats: {
          uploads: uploadStats[0] || {
            totalUploads: 0,
            healthyDetections: 0,
            diseaseDetections: 0,
            avgConfidence: 0
          },
          chat: chatStats[0] || {
            totalMessages: 0,
            totalSessions: 0,
            userMessages: 0,
            aiMessages: 0,
            avgResponseTime: 0
          }
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving dashboard data'
    });
  }
});

// @route   DELETE /user/account
// @desc    Delete user account
// @access  Private
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // In a production environment, you might want to:
    // 1. Soft delete instead of hard delete
    // 2. Clean up associated data (uploads, messages)
    // 3. Send confirmation email
    // 4. Add a grace period before actual deletion

    await User.findByIdAndDelete(req.user._id);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting account'
    });
  }
});

// @route   GET /user/activity
// @desc    Get user activity history
// @access  Private
router.get('/activity', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const skip = (page - 1) * limit;

    let activities = [];

    // Get uploads
    if (!type || type === 'uploads') {
      const uploads = await Upload.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select('filename originalName analysisResult processingStatus createdAt uploadType');
      
      activities = activities.concat(uploads.map(upload => ({
        type: 'upload',
        id: upload._id,
        title: upload.originalName,
        description: upload.analysisResult.diseaseName || 'Analysis pending',
        status: upload.processingStatus,
        createdAt: upload.createdAt,
        metadata: {
          uploadType: upload.uploadType,
          confidence: upload.analysisResult.confidence
        }
      })));
    }

    // Get chat sessions
    if (!type || type === 'chat') {
      const sessions = await Message.getUserSessions(req.user._id, parseInt(limit));
      
      activities = activities.concat(sessions.map(session => ({
        type: 'chat',
        id: session._id,
        title: `Chat Session`,
        description: session.lastMessage.content.text?.substring(0, 100) + '...' || 'Chat session',
        status: 'completed',
        createdAt: session.lastMessageAt,
        metadata: {
          messageCount: session.messageCount,
          sessionId: session._id
        }
      })));
    }

    // Sort by date
    activities.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      message: 'Activity history retrieved successfully',
      data: {
        activities: activities.slice(0, parseInt(limit)),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: activities.length
        }
      }
    });

  } catch (error) {
    console.error('Get activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving activity history'
    });
  }
});

module.exports = router;