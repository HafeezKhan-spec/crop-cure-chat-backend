const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/db');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const chatRoutes = require('./routes/chatRoutes');
const modelRoutes = require('./routes/modelRoutes');

// Initialize Express app
const app = express();

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
  // In production, specify allowed origins
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'https://crop-cure-chat-frontend.vercel.app',
    // Add your production frontend URLs here
  ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy (for rate limiting and IP detection)
app.set('trust proxy', 1);

// Serve static files (uploaded images)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'AgriClip API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/model', modelRoutes);

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Welcome to AgriClip API',
    version: '1.0.0',
    documentation: {
      endpoints: {
        auth: {
          'POST /api/auth/signup': 'Register a new user',
          'POST /api/auth/login': 'Login user',
          'POST /api/auth/refresh': 'Refresh JWT token',
          'POST /api/auth/logout': 'Logout user',
          'GET /api/auth/verify': 'Verify JWT token'
        },
        user: {
          'GET /api/user/profile': 'Get user profile',
          'PUT /api/user/profile': 'Update user profile',
          'GET /api/user/dashboard': 'Get dashboard data',
          'GET /api/user/activity': 'Get user activity history',
          'DELETE /api/user/account': 'Delete user account'
        },
        upload: {
          'POST /api/upload/image': 'Upload single image',
          'POST /api/upload/file': 'Upload multiple files',
          'GET /api/upload/history': 'Get upload history',
          'GET /api/upload/:id': 'Get upload details',
          'DELETE /api/upload/:id': 'Delete upload',
          'GET /api/upload/file/:filename': 'Serve uploaded file'
        },
        chat: {
          'POST /api/chat/message': 'Send chat message',
          'GET /api/chat/history/:sessionId': 'Get chat history',
          'GET /api/chat/sessions': 'Get chat sessions',
          'PUT /api/chat/message/:messageId': 'Edit message',
          'DELETE /api/chat/message/:messageId': 'Delete message',
          'POST /api/chat/message/:messageId/reaction': 'Add reaction',
          'DELETE /api/chat/session/:sessionId': 'Delete chat session'
        },
        model: {
          'POST /api/model/classify': 'Classify crop image',
          'GET /api/model/classify/:uploadId/status': 'Get classification status',
          'GET /api/model/details': 'Get model information',
          'GET /api/model/diseases': 'Get disease list',
          'GET /api/model/diseases/:diseaseId': 'Get disease details'
        }
      },
      authentication: 'Bearer token required for protected endpoints',
      rateLimit: '100 requests per 15 minutes per IP',
      fileUpload: 'Maximum 10MB per file, images only for crop analysis'
    },
    status: 'operational',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors
    });
  }

  // Mongoose cast error (invalid ObjectId)
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Multer errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large'
    });
  }

  if (error.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({
      success: false,
      message: 'Too many files'
    });
  }

  // CORS error
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS policy violation'
    });
  }

  // Default server error
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.error('Unhandled Promise Rejection:', err.message);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Start server
const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

module.exports = app;