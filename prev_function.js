const ExifReader = require('exifreader');
const sharp = require('sharp'); 

const DEFAULT_VALIDATION_CONFIG = {
  maxFileSizeInMB: 10,
  minImageWidth: 800,
  minImageHeight: 600,
  timeBufferMinutes: 60,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/jpg', 'image/heic', 'image/heif'],
  allowedExtensions: ['.jpeg', '.jpg', '.png', '.heic', '.heif'],
  requireOriginalPhoto: true,
  minQualityScore: 0.5,
  // Compression settings
  targetFileSizeMB: 5,
  maxCompressionAttempts: 5,
  initialQuality: 90,
  minimumQuality: 60,
  // Source validation config
  allowedSources: ['phone_camera', 'snapchat'],
  knownCameraSoftware: [
    'snapchat',
    'camera',
    'iphone',
    'samsung camera',
    'google camera',
    'huawei camera',
    'oneplus camera',
    'xiaomi camera',
    'oppo camera',
    'vivo camera'
  ]
};

// Helper function to check if file extension is allowed
const isAllowedExtension = (fileName, allowedExtensions) => {
  const fileExtension = fileName.slice(((fileName.lastIndexOf(".") - 1) >>> 0) + 2).toLowerCase();
  return allowedExtensions.includes(`.${fileExtension}`);
};

const compressImage = async (imageBuffer, targetSizeMB, config = DEFAULT_VALIDATION_CONFIG) => {
  const targetSizeBytes = targetSizeMB * 1024 * 1024;
  let quality = config.initialQuality;
  let compressedBuffer = imageBuffer;
  let attempt = 0;
  let metadata = null;

  try {
    // Get initial image metadata
    metadata = await sharp(imageBuffer).metadata();
    
    // If image is already smaller than target size, return original
    if (imageBuffer.length <= targetSizeBytes) {
      return {
        buffer: imageBuffer,
        metadata: {
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
          size: imageBuffer.length,
          quality: 100
        }
      };
    }

    while (attempt < config.maxCompressionAttempts && quality >= config.minimumQuality) {
      // Compress the image
      compressedBuffer = await sharp(imageBuffer)
        .jpeg({ quality: quality })
        .toBuffer();

      // If we've reached target size or can't compress further
      if (compressedBuffer.length <= targetSizeBytes || quality <= config.minimumQuality) {
        break;
      }

      // Adjust quality based on how far we are from target size
      const ratio = targetSizeBytes / compressedBuffer.length;
      quality = Math.max(Math.floor(quality * ratio), config.minimumQuality);
      attempt++;
    }

    // Get final metadata
    const finalMetadata = await sharp(compressedBuffer).metadata();

    return {
      buffer: compressedBuffer,
      metadata: {
        format: finalMetadata.format,
        width: finalMetadata.width,
        height: finalMetadata.height,
        size: compressedBuffer.length,
        quality: quality
      }
    };
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`);
  }
};

const extractFileMetadata = async (file, config = DEFAULT_VALIDATION_CONFIG) => {
  if (!file) {
    throw new Error('Missing required parameter - file');
  }

  if (!file.name || !file.mimetype || !file.size || !file.data) {
    throw new Error('Invalid file object - missing required properties');
  }

  let fileData = file.data;
  let originalSize = file.size;
  let wasCompressed = false;

  // Check if file size
  if (file.size > config.maxFileSizeInMB * 1024 * 1024) {
    try {
      const compressionResult = await compressImage(file.data, config.targetFileSizeMB, config);
      fileData = compressionResult.buffer;
      wasCompressed = true;
      
      // Update the file object with compressed data
      file.data = fileData;
      file.size = fileData.length;
    } catch (error) {
      console.warn('Image compression failed:', error);
      // Continue with original file if compression fails
    }
  }

  const metadata = {
    originalName: file.name,
    mimetype: file.mimetype,
    size: file.size,
    sizeInMB: file.size / (1024 * 1024),
    originalSize,
    originalSizeInMB: originalSize / (1024 * 1024),
    wasCompressed,
    compressionRatio: wasCompressed ? (file.size / originalSize).toFixed(2) : 1,
    dimensions: null,
    qualityScore: null,
    possibleCreationSources: [],
    createdAt: null,
    validationErrors: [],
    validationWarnings: [],
    sourceApplication: null,
    isOriginalPhoto: false
  };

  try {
    // Check MIME type and extension for application/octet-stream
    if (
      metadata.mimetype === 'application/octet-stream' &&
      !isAllowedExtension(file.name, config.allowedExtensions)
    ) {
      metadata.validationErrors.push(
        `File type ${metadata.mimetype} is not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}`
      );
    } else if (
      metadata.mimetype !== 'application/octet-stream' &&
      !config.allowedMimeTypes.includes(metadata.mimetype)
    ) {
      metadata.validationErrors.push(
        `File type ${metadata.mimetype} is not allowed. Allowed types: ${config.allowedMimeTypes.join(', ')}`
      );
    }

    if (file.mimetype.startsWith('image/')) {
      try {
        const tags = ExifReader.load(fileData);
        console.log(tags)
        // Check for source application in EXIF data
        const softwareTags = [
          'Software',
          'ApplicationRecordVersion',
          'ApplicationName',
          'CreatorTool'
        ];

        let sourceFound = false;
        for (const tag of softwareTags) {
          if (tags[tag] && tags[tag].description) {
            const software = tags[tag].description.toLowerCase();
            metadata.sourceApplication = software;

            // Check if it's from Snapchat
            if (software.includes('snapchat')) {
              metadata.possibleCreationSources.push('snapchat');
              sourceFound = true;
              metadata.isOriginalPhoto = true;
              break;
            }

            // Check if it's from a phone camera
            for (const cameraApp of config.knownCameraSoftware) {
              if (software.includes(cameraApp)) {
                metadata.possibleCreationSources.push('phone_camera');
                sourceFound = true;
                metadata.isOriginalPhoto = true;
                break;
              }
            }
          }
        }

        // Additional checks for phone camera characteristics
        if (!sourceFound) {
          const hasGPS = tags.GPSLatitude || tags.GPSLongitude;
          const hasCameraInfo = tags.Make || tags.Model;
          const hasOriginalDate = tags.DateTimeOriginal;
          
          if (hasCameraInfo && hasOriginalDate) {
            metadata.possibleCreationSources.push('phone_camera');
            metadata.isOriginalPhoto = true;
            sourceFound = true;
          }
        }

        if (!sourceFound && config.requireOriginalPhoto) {
          metadata.validationErrors.push(
            'Image must be taken directly from Snapchat or a phone camera. Screenshots, downloaded, or edited images are not allowed.'
          );
        }

        // Extract creation time from EXIF data
        const dateFields = [
          'DateTimeOriginal',
          'CreateDate',
          'ModifyDate',
          'DateTime'
        ];

        for (const field of dateFields) {
          if (tags[field] && tags[field].description) {
            const parsedDate = new Date(tags[field].description);
            if (!isNaN(parsedDate.getTime())) {
              metadata.createdAt = parsedDate;
              metadata.possibleCreationSources.push('EXIF');

              // Calculate rough quality score based on EXIF data
              if (tags.Quality) {
                metadata.qualityScore = parseInt(tags.Quality.description) / 100;
              }
              break;
            }
          }
        }

        // Extract additional EXIF information
        if (tags.Make) metadata.cameraMake = tags.Make.description;
        if (tags.Model) metadata.cameraModel = tags.Model.description;
        if (tags.ISO) metadata.iso = tags.ISO.description;

      } catch (e) {
        if (config.requireOriginalPhoto) {
          metadata.validationErrors.push(
            'Unable to verify image source. Please ensure you are uploading an original photo from Snapchat or phone camera.'
          );
        } else {
          metadata.validationWarnings.push('No EXIF data found');
        }
      }
    }

    // Try file system dates if EXIF not available
    if (!metadata.createdAt && file.lastModifiedDate) {
      metadata.createdAt = new Date(file.lastModifiedDate);
      metadata.possibleCreationSources.push('lastModifiedDate');
    }

    // Last resort: use current time
    if (!metadata.createdAt) {
      const tags2 = ExifReader.load(fileData);
      console.log(tags2)
      metadata.createdAt = new Date();
      metadata.possibleCreationSources.push('current');
      
      if (config.requireOriginalPhoto) {
        metadata.validationErrors.push(
          'Could not verify original photo creation time. Please upload original photos directly from your camera/phone.'
        );
      } else {
        metadata.validationWarnings.push(
          'Using current time as creation time - this may not reflect when the photo was actually taken'
        );
      }
    }

    // If the image was compressed, add a warning
    if (wasCompressed) {
      metadata.validationWarnings.push(
        `Image was automatically compressed from ${metadata.originalSizeInMB.toFixed(2)}MB to ${metadata.sizeInMB.toFixed(2)}MB`
      );
    }

    return metadata;
  } catch (error) {
    console.error('Metadata extraction error:', error);
    throw new Error(`Failed to extract metadata: ${error.message}`);
  }
};

const validateFileCreationTime = (fileMetadata, eventStart, eventEnd, config = DEFAULT_VALIDATION_CONFIG) => {
  const createdAt = fileMetadata.createdAt;
  const creationSource = fileMetadata.possibleCreationSources[0];
  
  const bufferedEventStart = new Date(eventStart.getTime() - config.timeBufferMinutes * 60 * 1000);
  const bufferedEventEnd = new Date(eventEnd.getTime() + config.timeBufferMinutes * 60 * 1000);

  const isValid = createdAt >= bufferedEventStart && createdAt <= bufferedEventEnd;

  // Calculate how far outside the event time the photo was taken (if invalid)
  let timeOffset = null;
  let timeOffsetMessage = '';

  if (!isValid) {
    const offsetInMinutes = createdAt < bufferedEventStart 
      ? Math.floor((bufferedEventStart - createdAt) / (1000 * 60)) // minutes before
      : Math.floor((createdAt - bufferedEventEnd) / (1000 * 60)); // minutes after
    
    // Calculate days, hours, and minutes
    const days = Math.floor(offsetInMinutes / (24 * 60));
    const hours = Math.floor((offsetInMinutes % (24 * 60)) / 60);
    const minutes = offsetInMinutes % 60;

    // Construct a human-readable message for the time offset
    timeOffsetMessage = `File was created ${days > 0 ? days + ' day(s) ' : ''}${hours > 0 ? hours + ' hour(s) ' : ''}${minutes} minute(s) ${createdAt < bufferedEventStart ? 'before' : 'after'} the allowed time window`;

    // Set the timeOffset object
    timeOffset = { days, hours, minutes };
  }

  return {
    isValid,
    createdAt,
    details: {
      fileCreatedAt: createdAt.toISOString(),
      eventStart: eventStart.toISOString(),
      eventEnd: eventEnd.toISOString(),
      creationSource,
      timeOffset,
      message: isValid 
        ? `File creation time is valid (detected via ${creationSource})`
        : timeOffsetMessage
    }
  };
};

const validateEventTimes = (startDate, endDate, startTime, endTime) => {
  // Helper function to convert date string (YYYY-MM-DD) and time string (HH:mm) to Date object
  const combineDateAndTime = (dateStr, timeStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes);
  };

  // Convert the date strings to Date objects
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  
  const start = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  
  // Combine date and time for full datetime comparison
  const startTimeObj = combineDateAndTime(startDate, startTime);
  const endTimeObj = combineDateAndTime(endDate, endTime);
  
  const now = new Date(); // Current date and time
  
  // Create a date-only version of now for date comparisons
  const todayDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  
  const validations = {
    isValid: true,
    errors: []
  };

  // First check if dates are valid
  if (start < todayDate) {
    validations.isValid = false;
    validations.errors.push('Start date cannot be in the past');
  }

  // Check if end date is before start date
  if (end < start) {
    validations.isValid = false;
    validations.errors.push('End date cannot be before start date');
  }

  // Special handling for today's date
  if (start.getTime() === todayDate.getTime()) {
    // Compare full datetime objects for today
    if (startTimeObj < now) {
      validations.isValid = false;
      validations.errors.push('Start time cannot be in the past for today\'s date. You can create 1 mins ahead of your current time if the event has started already!!');
    }
  }

  // Check end time vs start time on the same day
  if (startDate === endDate && endTimeObj < startTimeObj) {
    validations.isValid = false;
    validations.errors.push('End time cannot be before start time on the same day');
  }

  return validations;
};
  

  module.exports = {
    extractFileMetadata,
    validateFileCreationTime,
    validateEventTimes,
    DEFAULT_VALIDATION_CONFIG,
  }