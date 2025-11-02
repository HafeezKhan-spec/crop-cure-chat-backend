const express = require('express');
const { body, validationResult } = require('express-validator');
const Upload = require('../models/Upload');
const Message = require('../models/Message');
const { authMiddleware, optionalAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// @route   GET /model/status
// @desc    Check the status of the model service
// @access  Public
router.get('/status', async (req, res) => {
  try {
    const axios = require('axios');
    const modelServiceUrl = process.env.MODEL_SERVICE_URL || 'http://localhost:8000';
    
    const response = await axios.get(`${modelServiceUrl}/health`);
    
    return res.json({
      success: true,
      message: 'Model service is running',
      data: {
        modelService: response.data
      }
    });
  } catch (error) {
    console.error('Error checking model service status:', error);
    
    return res.status(503).json({
      success: false,
      message: 'Model service is not available',
      error: error.message
    });
  }
});

// @route   GET /model/diseases
// @desc    Get list of diseases from the model service
// @access  Public
router.get('/diseases', async (req, res) => {
  try {
    const axios = require('axios');
    const modelServiceUrl = process.env.MODEL_SERVICE_URL || 'http://localhost:8000';
    
    const response = await axios.get(`${modelServiceUrl}/diseases`);
    
    return res.json({
      success: true,
      message: 'Disease list retrieved successfully',
      data: response.data.data
    });
  } catch (error) {
    console.error('Error fetching disease list:', error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve disease list',
      error: error.message
    });
  }
});

// @route   POST /model/classify
// @desc    Classify crop image for disease detection
// @access  Private
router.post('/classify', [
  authMiddleware,
  body('uploadId')
    .isMongoId()
    .withMessage('Invalid upload ID'),
  body('imageDomain')
    .optional()
    .isIn(['plant', 'livestock', 'fish'])
    .withMessage('imageDomain must be one of plant, livestock, fish'),
  body('cropType')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Crop type must be between 1 and 50 characters'),
  body('location')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Location must be between 1 and 100 characters'),
  body('sessionId')
    .optional()
    .isUUID()
    .withMessage('Invalid session ID format')
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

    const { uploadId, imageDomain, cropType, location, additionalInfo } = req.body;

    // Find the upload
    const upload = await Upload.findOne({
      _id: uploadId,
      userId: req.user._id
    });

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: 'Upload not found'
      });
    }

    // Check if already processed
    if (upload.processingStatus === 'completed') {
      return res.json({
        success: true,
        message: 'Classification already completed',
        data: {
          classification: {
            uploadId: upload._id,
            diseaseDetected: upload.analysisResult.diseaseDetected,
            diseaseName: upload.analysisResult.diseaseName,
            confidence: upload.analysisResult.confidence,
            severity: upload.analysisResult.severity,
            affectedArea: upload.analysisResult.affectedArea,
            recommendations: upload.analysisResult.recommendations,
            processingTime: 0,
            model: (upload.analysisResult && upload.analysisResult.model) || 'agriclip-original'
          }
        }
      });
    }

    // Update processing status
    upload.processingStatus = 'processing';
    await upload.save();

    // Connect to FastAPI AgriClip model service
    const axios = require('axios');
    const FormData = require('form-data');
    const fs = require('fs');
    const path = require('path');
    
    // Get the FastAPI model service URL from environment variables
    const modelServiceUrl = process.env.MODEL_SERVICE_URL || 'http://localhost:8000';
    
    // Process the image with FastAPI model after a short delay
    setTimeout(async () => {
      try {
        // Create form data for the FastAPI request
        const formData = new FormData();
        
        // Get the file path - fix path construction
        const filePath = path.resolve(upload.filePath);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        
        // Add the image file to form data
        formData.append('file', fs.createReadStream(filePath));
        
        // Add other required fields
        formData.append('uploadId', uploadId);
        if (imageDomain) formData.append('imageDomain', imageDomain);
        if (cropType) formData.append('cropType', cropType);
        if (location) formData.append('location', location);
        if (additionalInfo) formData.append('additionalInfo', JSON.stringify(additionalInfo));
        
        console.log(`Starting classification for upload ${uploadId} with FastAPI service at ${modelServiceUrl}`);
        
        // Make request to FastAPI model service
        const response = await axios.post(`${modelServiceUrl}/classify`, formData, {
          headers: {
            ...formData.getHeaders(),
          },
          timeout: 30000 // 30 second timeout
        });
        
        // Extract the analysis result from the response
        const { data } = response;
        const analysisResult = data.data.classification;
        const narrative = data.data.report || null;

        // Update upload with results
        await Upload.findByIdAndUpdate(uploadId, {
          analysisResult,
          analysisNarrative: narrative,
          processingStatus: 'completed',
          'context.cropType': cropType,
          'context.location': location,
          'context.additionalInfo': additionalInfo,
          'context.imageDomain': imageDomain
        });

        // Optionally persist an AI chat message with the narrative
        if (narrative) {
          try {
            const uploadDoc = await Upload.findById(uploadId);
            const sessionId = req.body.sessionId || undefined;
            const attachment = uploadDoc ? [{
              uploadId: uploadDoc._id,
              filename: uploadDoc.filename,
              originalName: uploadDoc.originalName,
              mimeType: uploadDoc.mimeType,
              fileSize: uploadDoc.fileSize,
              fileUrl: `/uploads/${uploadDoc.filename}`
            }] : [];

            const aiMessage = new Message({
              userId: req.user._id,
              sessionId: sessionId,
              messageType: 'ai',
              content: {
                text: narrative,
                attachments: attachment
              },
              aiResponse: {
                model: analysisResult?.model || 'agriclip-plantvillage-15k',
                confidence: analysisResult?.confidence || 0,
                processingTime: analysisResult?.processingTime || 0
              },
              context: {
                conversationTopic: 'crop_analysis'
              },
              status: 'completed'
            });
            await aiMessage.save();
          } catch (e) {
            console.warn('Failed to persist AI narrative message:', e.message);
          }
        }
        
        // Notify client about completed analysis
        console.log(`Classification completed for upload ${uploadId}:`, analysisResult);
        
        // You could implement WebSocket notifications here
        // to notify clients when their processing is complete

      } catch (error) {
        console.error('Classification processing error:', error);
        
        // Handle different types of errors
        let errorMessage = 'Unknown error during classification';
        
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          console.error('FastAPI error response:', error.response.data);
          errorMessage = error.response.data.detail || `Error ${error.response.status}: ${error.response.statusText}`;
        } else if (error.request) {
          // The request was made but no response was received
          console.error('No response received from FastAPI service');
          errorMessage = 'Model service unavailable. Please try again later.';
        } else {
          // Something happened in setting up the request that triggered an Error
          console.error('Error setting up request:', error.message);
          errorMessage = error.message;
        }
        
        await Upload.findByIdAndUpdate(uploadId, {
          processingStatus: 'failed',
          processingError: errorMessage
        });
      }
    }, Math.floor(Math.random() * 3000) + 2000); // 2-5 second delay

    res.json({
      success: true,
      message: 'Classification started successfully',
      data: {
        uploadId,
        status: 'processing',
        estimatedTime: '2-5 seconds',
        message: 'Your image is being analyzed. Please check back shortly for results.'
      }
    });

  } catch (error) {
    console.error('Classification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during classification'
    });
  }
});

// @route   GET /model/classify/:uploadId/status
// @desc    Get classification status and results
// @access  Private
router.get('/classify/:uploadId/status', authMiddleware, async (req, res) => {
  try {
    const { uploadId } = req.params;

    const upload = await Upload.findOne({
      _id: uploadId,
      userId: req.user._id
    });

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: 'Upload not found'
      });
    }

    const response = {
      success: true,
      message: 'Classification status retrieved successfully',
      data: {
        uploadId: upload._id,
        status: upload.processingStatus,
        createdAt: upload.createdAt,
        updatedAt: upload.updatedAt
      }
    };

    if (upload.processingStatus === 'completed') {
      response.data.classification = {
        diseaseDetected: upload.analysisResult.diseaseDetected,
        diseaseName: upload.analysisResult.diseaseName,
        confidence: upload.analysisResult.confidence,
        severity: upload.analysisResult.severity,
        affectedArea: upload.analysisResult.affectedArea,
        recommendations: upload.analysisResult.recommendations
      };
      if (upload.analysisNarrative) {
        response.data.report = upload.analysisNarrative;
      }
    } else if (upload.processingStatus === 'failed') {
      response.data.error = upload.processingError;
    }

    res.json(response);

  } catch (error) {
    console.error('Get classification status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving classification status'
    });
  }
});

// @route   GET /model/details
// @desc    Get model information and capabilities
// @access  Public
router.get('/details', optionalAuth, async (req, res) => {
  try {
    // TODO: Replace with FastAPI T5 model integration
    const modelDetails = {
      models: [
        {
          name: 'AgriClip Disease Detection',
          version: 'v1.0.0',
          type: 'image_classification',
          description: 'Advanced deep learning model for crop disease detection',
          capabilities: [
            'Disease identification',
            'Severity assessment',
            'Treatment recommendations',
            'Confidence scoring'
          ],
          supportedCrops: [
            'Corn/Maize',
            'Wheat',
            'Rice',
            'Soybeans',
            'Tomatoes',
            'Potatoes',
            'Cotton',
            'Sugarcane'
          ],
          supportedDiseases: [
            'Leaf Spot',
            'Rust',
            'Blight',
            'Bacterial infections',
            'Viral infections',
            'Fungal infections',
            'Nutrient deficiencies'
          ],
          accuracy: {
            overall: 94.2,
            diseaseDetection: 96.8,
            diseaseClassification: 91.5,
            severityAssessment: 89.3
          },
          inputRequirements: {
            imageFormat: ['JPEG', 'PNG', 'WebP'],
            minResolution: '224x224',
            maxFileSize: '10MB',
            recommendedLighting: 'Natural daylight or bright artificial light',
            recommendedDistance: '30-50cm from affected area'
          },
          processingTime: {
            average: '2-3 seconds',
            maximum: '10 seconds'
          },
          lastUpdated: '2024-01-15T10:00:00Z'
        },
        {
          name: 'AgriClip Chat Assistant',
          version: 'v1.0.0',
          type: 'text_generation',
          description: 'AI-powered agricultural advisory system',
          capabilities: [
            'Farming advice',
            'Disease information',
            'Treatment guidance',
            'Crop management tips',
            'Weather-based recommendations'
          ],
          languages: ['English', 'Telugu', 'Hindi', 'Spanish', 'French'],
          knowledgeBase: {
            crops: 50,
            diseases: 200,
            treatments: 500,
            regions: 'Global with regional adaptations'
          },
          lastUpdated: '2024-01-15T10:00:00Z'
        }
      ],
      statistics: {
        totalAnalyses: 125847,
        accuracyRate: 94.2,
        averageResponseTime: 2.3,
        supportedLanguages: 5,
        activeUsers: 15420
      },
      apiVersion: '1.0.0',
      status: 'operational',
      uptime: '99.9%',
      lastMaintenance: '2024-01-10T02:00:00Z',
      nextMaintenance: '2024-02-10T02:00:00Z'
    };

    res.json({
      success: true,
      message: 'Model details retrieved successfully',
      data: modelDetails
    });

  } catch (error) {
    console.error('Get model details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving model details'
    });
  }
});

// @route   GET /model/diseases
// @desc    Get list of supported diseases
// @access  Public
router.get('/diseases', optionalAuth, async (req, res) => {
  try {
    const { crop, category, search } = req.query;

    // TODO: Replace with actual disease database
    let diseases = [
      {
        id: 'northern_corn_leaf_blight',
        name: 'Northern Corn Leaf Blight',
        scientificName: 'Exserohilum turcicum',
        category: 'fungal',
        crops: ['corn', 'maize'],
        symptoms: [
          'Long, elliptical lesions on leaves',
          'Gray-green to tan colored spots',
          'Lesions may have dark borders'
        ],
        causes: [
          'High humidity',
          'Moderate temperatures (18-27°C)',
          'Poor air circulation'
        ],
        treatments: [
          'Fungicide application',
          'Crop rotation',
          'Resistant varieties'
        ],
        severity: 'medium',
        prevalence: 'common'
      },
      {
        id: 'bacterial_leaf_spot',
        name: 'Bacterial Leaf Spot',
        scientificName: 'Xanthomonas campestris',
        category: 'bacterial',
        crops: ['tomato', 'pepper', 'beans'],
        symptoms: [
          'Small, dark spots on leaves',
          'Yellow halos around spots',
          'Leaf yellowing and drop'
        ],
        causes: [
          'Warm, humid conditions',
          'Overhead irrigation',
          'Poor sanitation'
        ],
        treatments: [
          'Copper-based bactericides',
          'Improved drainage',
          'Sanitation practices'
        ],
        severity: 'high',
        prevalence: 'common'
      },
      {
        id: 'rust_disease',
        name: 'Rust Disease',
        scientificName: 'Puccinia spp.',
        category: 'fungal',
        crops: ['wheat', 'corn', 'soybeans'],
        symptoms: [
          'Orange to reddish-brown pustules',
          'Powdery spore masses',
          'Leaf yellowing'
        ],
        causes: [
          'High humidity',
          'Moderate temperatures',
          'Wind dispersal'
        ],
        treatments: [
          'Fungicide sprays',
          'Resistant varieties',
          'Crop rotation'
        ],
        severity: 'medium',
        prevalence: 'seasonal'
      }
    ];

    // Apply filters
    if (crop) {
      diseases = diseases.filter(disease => 
        disease.crops.some(c => c.toLowerCase().includes(crop.toLowerCase()))
      );
    }

    if (category) {
      diseases = diseases.filter(disease => 
        disease.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (search) {
      const searchTerm = search.toLowerCase();
      diseases = diseases.filter(disease =>
        disease.name.toLowerCase().includes(searchTerm) ||
        disease.scientificName.toLowerCase().includes(searchTerm) ||
        disease.symptoms.some(symptom => symptom.toLowerCase().includes(searchTerm))
      );
    }

    res.json({
      success: true,
      message: 'Disease information retrieved successfully',
      data: {
        diseases,
        total: diseases.length,
        filters: {
          crop,
          category,
          search
        }
      }
    });

  } catch (error) {
    console.error('Get diseases error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving disease information'
    });
  }
});

// @route   GET /model/diseases/:diseaseId
// @desc    Get detailed information about a specific disease
// @access  Public
router.get('/diseases/:diseaseId', optionalAuth, async (req, res) => {
  try {
    const { diseaseId } = req.params;

    // TODO: Replace with actual disease database lookup
    const diseaseDetails = {
      id: diseaseId,
      name: 'Northern Corn Leaf Blight',
      scientificName: 'Exserohilum turcicum',
      category: 'fungal',
      description: 'A common fungal disease affecting corn and other grasses, characterized by long, elliptical lesions on leaves.',
      crops: ['corn', 'maize', 'sorghum'],
      symptoms: {
        early: [
          'Small, water-soaked spots on leaves',
          'Spots appear gray-green initially'
        ],
        advanced: [
          'Long, elliptical lesions (6-12 inches)',
          'Tan to gray-brown coloration',
          'Dark borders around lesions',
          'Lesions may coalesce'
        ]
      },
      causes: {
        pathogen: 'Exserohilum turcicum (fungus)',
        conditions: [
          'High humidity (>90%)',
          'Moderate temperatures (18-27°C)',
          'Poor air circulation',
          'Extended leaf wetness'
        ],
        transmission: [
          'Wind-blown spores',
          'Rain splash',
          'Infected crop residue'
        ]
      },
      treatments: {
        chemical: [
          'Azoxystrobin-based fungicides',
          'Propiconazole applications',
          'Preventive spraying programs'
        ],
        biological: [
          'Bacillus subtilis treatments',
          'Trichoderma applications'
        ],
        cultural: [
          'Crop rotation (2-3 years)',
          'Resistant varieties',
          'Proper field sanitation',
          'Improved drainage'
        ]
      },
      prevention: [
        'Plant resistant hybrids',
        'Avoid overhead irrigation',
        'Maintain proper plant spacing',
        'Remove crop debris after harvest',
        'Monitor weather conditions'
      ],
      economicImpact: {
        yieldLoss: '10-40%',
        affectedRegions: 'Corn-growing regions worldwide',
        costOfTreatment: '$15-30 per acre'
      },
      severity: 'medium',
      prevalence: 'common',
      seasonality: 'Mid to late growing season',
      images: [
        '/images/diseases/northern_corn_leaf_blight_1.jpg',
        '/images/diseases/northern_corn_leaf_blight_2.jpg'
      ],
      relatedDiseases: [
        'southern_corn_leaf_blight',
        'gray_leaf_spot',
        'common_rust'
      ],
      lastUpdated: '2024-01-15T10:00:00Z'
    };

    res.json({
      success: true,
      message: 'Disease details retrieved successfully',
      data: {
        disease: diseaseDetails
      }
    });

  } catch (error) {
    console.error('Get disease details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while retrieving disease details'
    });
  }
});

module.exports = router;