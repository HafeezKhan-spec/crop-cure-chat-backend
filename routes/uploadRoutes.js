const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const Upload = require('../models/Upload');
const { authMiddleware } = require('../middleware/authMiddleware');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 5 // Maximum 5 files per request
  }
});

// @route   POST /upload/image
// @desc    Upload image for crop analysis
// @access  Private
router.post('/image', [
  authMiddleware,
  upload.single('image'),
  body('uploadType')
    .optional()
    .isIn(['crop_analysis', 'chat_attachment', 'profile_picture'])
    .withMessage('Invalid upload type'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array')
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

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const { uploadType = 'crop_analysis', tags = [] } = req.body;

    // Determine file type
    let fileType = 'other';
    if (req.file.mimetype.startsWith('image/')) {
      fileType = 'image';
    }

    // Create upload record
    const uploadRecord = new Upload({
      userId: req.user._id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      fileType,
      uploadType,
      tags: Array.isArray(tags) ? tags : [],
      processingStatus: 'pending'
    });

    await uploadRecord.save();

    // Note: Actual AI processing is handled by /api/model/classify endpoint
    // This upload route only handles file storage, not analysis

    res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        uploadId: uploadRecord._id,
        filename: uploadRecord.filename,
        originalName: uploadRecord.originalName,
        fileSize: uploadRecord.fileSize,
        uploadType: uploadRecord.uploadType,
        processingStatus: uploadRecord.processingStatus,
        createdAt: uploadRecord.createdAt,
        fileUrl: `/uploads/${uploadRecord.filename}`
      }
    });

  } catch (error) {
    console.error('Image upload error:', error);
    
    // Clean up uploaded file if database save failed
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 10MB.'
        });
      }
      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          message: 'Too many files. Maximum 5 files allowed.'
        });
      }
    }

    res.status(500).json({
      success: false,
      message: 'Server error during image upload'
    });
  }
});

// @route   POST /upload/file
// @desc    Upload multiple files
// @access  Private
router.post('/file', [
  authMiddleware,
  upload.array('files', 5),
  body('uploadType')
    .optional()
    .isIn(['crop_analysis', 'chat_attachment', 'profile_picture'])
    .withMessage('Invalid upload type')
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

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const { uploadType = 'crop_analysis' } = req.body;
    const uploadedFiles = [];

    // Process each file
    for (const file of req.files) {
      let fileType = 'other';
      if (file.mimetype.startsWith('image/')) {
        fileType = 'image';
      }

      const uploadRecord = new Upload({
        userId: req.user._id,
        filename: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileType,
        uploadType,
        processingStatus: 'pending'
      });

      await uploadRecord.save();
      
      uploadedFiles.push({
        id: uploadRecord._id,
        filename: uploadRecord.filename,
        originalName: uploadRecord.originalName,
        fileSize: uploadRecord.fileSize,
        uploadType: uploadRecord.uploadType,
        processingStatus: uploadRecord.processingStatus,
        createdAt: uploadRecord.createdAt,
        fileUrl: `/uploads/${uploadRecord.filename}`
      });
    }

    res.status(201).json({
      success: true,
      message: `${uploadedFiles.length} files uploaded successfully`,
      data: {
        uploads: uploadedFiles
      }
    });

  } catch (error) {
    console.error('File upload error:', error);
    
    // Clean up uploaded files if database save failed
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during file upload'
    });
  }
});

// @route   GET /upload/history
// @desc    Get user's upload history
// @access  Private
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, uploadType, status } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = { userId: req.user._id };
    if (uploadType) query.uploadType = uploadType;
    if (status) query.processingStatus = status;

    // Get uploads with pagination
    const uploads = await Upload.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-filePath'); // Don't expose file system paths

    // Get total count
    const total = await Upload.countDocuments(query);

    // Add file URLs
    const uploadsWithUrls = uploads.map(upload => ({
      ...upload.toObject(),
      fileUrl: `/uploads/${upload.filename}`
    }));

    res.json({
      success: true,
      message: 'Upload history retrieved successfully',
      data: {
        uploads: uploadsWithUrls,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get upload history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving upload history'
    });
  }
});

// @route   GET /upload/stats
// @desc    Get user's upload/analysis activity stats
// @access  Private
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    // Aggregate stats from uploads
    const statsAgg = await Upload.getAnalysisStats(req.user._id);

    const baseStats = {
      totalAnalyses: 0,
      healthyDetections: 0,
      diseaseDetections: 0,
      avgConfidence: null
    };

    const stats = statsAgg && statsAgg.length > 0 ? {
      totalAnalyses: statsAgg[0].totalUploads || 0,
      healthyDetections: statsAgg[0].healthyDetections || 0,
      diseaseDetections: statsAgg[0].diseaseDetections || 0,
      avgConfidence: typeof statsAgg[0].avgConfidence === 'number' ? Math.round(statsAgg[0].avgConfidence) : null
    } : baseStats;

    res.json({
      success: true,
      message: 'Upload stats retrieved successfully',
      data: stats
    });
  } catch (error) {
    console.error('Get upload stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving upload stats'
    });
  }
});

// @route   GET /upload/:id
// @desc    Get specific upload details
// @access  Private
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const upload = await Upload.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).select('-filePath');

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: 'Upload not found'
      });
    }

    const uploadData = {
      ...upload.toObject(),
      fileUrl: `/uploads/${upload.filename}`
    };

    res.json({
      success: true,
      message: 'Upload details retrieved successfully',
      data: {
        upload: uploadData
      }
    });

  } catch (error) {
    console.error('Get upload details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving upload details'
    });
  }
});

// @route   DELETE /upload/:id
// @desc    Delete an upload
// @access  Private
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const upload = await Upload.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: 'Upload not found'
      });
    }

    // Delete file from filesystem
    if (fs.existsSync(upload.filePath)) {
      fs.unlinkSync(upload.filePath);
    }

    // Delete from database
    await Upload.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Upload deleted successfully'
    });

  } catch (error) {
    console.error('Delete upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while deleting upload'
    });
  }
});

// @route   GET /upload/file/:filename
// @desc    Serve uploaded files
// @access  Public (with basic security)
router.get('/file/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);

    // Basic security check
    if (!filename.match(/^[a-zA-Z0-9\-_.]+$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid filename'
      });
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Serve the file
    res.sendFile(filePath);

  } catch (error) {
    console.error('Serve file error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while serving file'
    });
  }
});

module.exports = router;