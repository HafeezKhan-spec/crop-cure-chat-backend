const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  messageType: {
    type: String,
    enum: ['user', 'ai', 'system'],
    required: true
  },
  content: {
    text: {
      type: String,
      required: function() {
        return !this.content.attachments || this.content.attachments.length === 0;
      }
    },
    attachments: [{
      uploadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Upload'
      },
      filename: String,
      originalName: String,
      mimeType: String,
      fileSize: Number,
      fileUrl: String
    }]
  },
  aiResponse: {
    model: {
      type: String,
      default: 'agriclip-original'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 100
    },
    processingTime: {
      type: Number // in milliseconds
    },
    tokens: {
      input: Number,
      output: Number
    }
  },
  context: {
    previousMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    conversationTopic: {
      type: String,
      enum: ['disease_detection', 'farming_advice', 'general', 'troubleshooting', 'crop_analysis']
    },
    userLocation: String,
    cropType: String,
    season: String
  },
  metadata: {
    userAgent: String,
    ipAddress: String,
    language: {
      type: String,
      default: 'en'
    },
    platform: String
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'processing', 'completed', 'failed'],
    default: 'sent'
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editHistory: [{
    content: String,
    editedAt: {
      type: Date,
      default: Date.now
    }
  }],
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reaction: {
      type: String,
      enum: ['helpful', 'not_helpful', 'accurate', 'inaccurate']
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
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
messageSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });
messageSchema.index({ messageType: 1 });
messageSchema.index({ status: 1 });
messageSchema.index({ 'context.conversationTopic': 1 });

// Update the updatedAt field before saving
messageSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for message age
messageSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Instance method to mark as edited
messageSchema.methods.markAsEdited = function(newContent) {
  this.editHistory.push({
    content: this.content.text,
    editedAt: new Date()
  });
  this.content.text = newContent;
  this.isEdited = true;
  return this.save();
};

// Instance method to add reaction
messageSchema.methods.addReaction = function(userId, reaction) {
  // Remove existing reaction from this user
  this.reactions = this.reactions.filter(r => !r.userId.equals(userId));
  
  // Add new reaction
  this.reactions.push({ userId, reaction });
  return this.save();
};

// Static method to get conversation history
messageSchema.statics.getConversationHistory = function(userId, sessionId, limit = 50) {
  return this.find({ 
    userId, 
    sessionId,
    isDeleted: false 
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .populate('content.attachments.uploadId', 'filename originalName analysisResult')
    .populate('userId', 'username profilePic');
};

// Static method to get user's chat sessions
messageSchema.statics.getUserSessions = function(userId, limit = 20) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), isDeleted: false } },
    {
      $group: {
        _id: '$sessionId',
        lastMessage: { $last: '$$ROOT' },
        messageCount: { $sum: 1 },
        firstMessageAt: { $min: '$createdAt' },
        lastMessageAt: { $max: '$createdAt' }
      }
    },
    { $sort: { lastMessageAt: -1 } },
    { $limit: limit }
  ]);
};

// Static method to get chat statistics
messageSchema.statics.getChatStats = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId), isDeleted: false } },
    {
      $group: {
        _id: null,
        totalMessages: { $sum: 1 },
        totalSessions: { $addToSet: '$sessionId' },
        userMessages: {
          $sum: { $cond: [{ $eq: ['$messageType', 'user'] }, 1, 0] }
        },
        aiMessages: {
          $sum: { $cond: [{ $eq: ['$messageType', 'ai'] }, 1, 0] }
        },
        avgResponseTime: { $avg: '$aiResponse.processingTime' }
      }
    },
    {
      $project: {
        totalMessages: 1,
        totalSessions: { $size: '$totalSessions' },
        userMessages: 1,
        aiMessages: 1,
        avgResponseTime: 1
      }
    }
  ]);
};

module.exports = mongoose.model('Message', messageSchema);