const mongoose = require('mongoose');

const uploadSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  filename: {
    type: String,
    required: [true, 'Filename is required']
  },
  originalName: {
    type: String,
    required: [true, 'Original filename is required']
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required']
  },
  fileType: {
    type: String,
    enum: ['image', 'document', 'other'],
    default: 'image'
  },
  uploadType: {
    type: String,
    enum: ['crop_analysis', 'chat_attachment', 'profile_picture'],
    default: 'crop_analysis'
  },
  analysisResult: {
    diseaseDetected: {
      type: Boolean,
      default: null
    },
    diseaseName: {
      type: String,
      default: null
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    },
    recommendations: [{
      type: String
    }],
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: null
    },
    affectedArea: {
      type: Number,
      min: 0,
      max: 100,
      default: null
    }
  },
  analysisNarrative: {
    type: String,
    default: null
  },
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  processingError: {
    type: String,
    default: null
  },
  metadata: {
    imageWidth: Number,
    imageHeight: Number,
    colorSpace: String,
    exifData: mongoose.Schema.Types.Mixed
  },
  tags: [{
    type: String,
    trim: true
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for better query performance
uploadSchema.index({ userId: 1, createdAt: -1 });
uploadSchema.index({ uploadType: 1 });
uploadSchema.index({ processingStatus: 1 });
uploadSchema.index({ 'analysisResult.diseaseDetected': 1 });

// Update the updatedAt field before saving
uploadSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for file URL (if serving files statically)
uploadSchema.virtual('fileUrl').get(function() {
  return `/uploads/${this.filename}`;
});

// Instance method to get analysis summary
uploadSchema.methods.getAnalysisSummary = function() {
  if (this.processingStatus !== 'completed' || !this.analysisResult.diseaseDetected) {
    return null;
  }

  return {
    diseaseDetected: this.analysisResult.diseaseDetected,
    diseaseName: this.analysisResult.diseaseName,
    confidence: this.analysisResult.confidence,
    severity: this.analysisResult.severity,
    recommendationsCount: this.analysisResult.recommendations.length
  };
};

// Static method to get user's recent uploads
uploadSchema.statics.getRecentUploads = function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'username email');
};

// Static method to get analysis statistics
uploadSchema.statics.getAnalysisStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalUploads: { $sum: 1 },
        healthyDetections: {
          $sum: {
            $cond: [{ $eq: ['$analysisResult.diseaseDetected', false] }, 1, 0]
          }
        },
        diseaseDetections: {
          $sum: {
            $cond: [{ $eq: ['$analysisResult.diseaseDetected', true] }, 1, 0]
          }
        },
        avgConfidence: { $avg: '$analysisResult.confidence' }
      }
    }
  ]);
};

module.exports = mongoose.model('Upload', uploadSchema);