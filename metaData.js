async function extractImageMetadata(buffer, file) {
    try {
        // Extract EXIF data using exifr
        const exifData = await exifr.parse(buffer, {
            gps: true,        // Include GPS data
            icc: false,       // Skip color profile data
            iptc: true,       // Include IPTC data
            xmp: false,       // Skip XMP data for performance
            jfif: true,       // Include JFIF data
            ihdr: true,       // Include PNG header data
            multiSegment: true,
            chunked: false,
            firstChunkSize: 40000,
            chunkSize: 10000
        })

        // Basic file information
        const fileInfo = {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: new Date(file.lastModified).toISOString()
        }

        // Process GPS data if available
        let locationData = null
        if (exifData && (exifData.latitude || exifData.longitude)) {
            locationData = {
                latitude: exifData.latitude,
                longitude: exifData.longitude,
                altitude: exifData.GPSAltitude,
                timestamp: exifData.GPSTimeStamp || exifData.GPSDateStamp
            }
        }

        // Process date/time information
        let dateTimeInfo = null
        if (exifData) {
            dateTimeInfo = {
                dateTimeOriginal: exifData.DateTimeOriginal,
                dateTimeDigitized: exifData.DateTimeDigitized,
                dateTime: exifData.DateTime,
                createDate: exifData.CreateDate,
                modifyDate: exifData.ModifyDate
            }
        }

        // Camera/device information
        let deviceInfo = null
        if (exifData) {
            deviceInfo = {
                make: exifData.Make,
                model: exifData.Model,
                software: exifData.Software,
                orientation: exifData.Orientation,
                xResolution: exifData.XResolution,
                yResolution: exifData.YResolution,
                colorSpace: exifData.ColorSpace
            }
        }

        // Camera settings
        let cameraSettings = null
        if (exifData) {
            cameraSettings = {
                iso: exifData.ISO,
                aperture: exifData.FNumber,
                shutterSpeed: exifData.ExposureTime,
                focalLength: exifData.FocalLength,
                flash: exifData.Flash,
                whiteBalance: exifData.WhiteBalance,
                exposureMode: exifData.ExposureMode
            }
        }

        // Detect potential file transfer patterns
        const transferDetection = detectFileTransfer(file.name, fileInfo.lastModified, exifData)

        return {
            fileInfo,
            location: locationData,
            dateTime: dateTimeInfo,
            device: deviceInfo,
            camera: cameraSettings,
            transferInfo: transferDetection,
            hasExifData: !!exifData,
            exifDataKeys: exifData ? Object.keys(exifData) : []
        }

    } catch (error) {
        console.error('Error extracting metadata:', error)
        return {
            fileInfo: {
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: new Date(file.lastModified).toISOString()
            },
            error: error.message,
            hasExifData: false
        }
    }
}

// Function to detect if file was likely transferred or processed
function detectFileTransfer(fileName, lastModified, exifData) {
    const transferIndicators = []
    const processingIndicators = []

    // Check filename patterns for transfers
    const transferPatterns = [
        { pattern: /^IMG-\d{8}-WA\d{4}/, name: 'WhatsApp transfer' },
        { pattern: /^received_\d+/, name: 'Facebook Messenger' },
        { pattern: /^\d{8}_\d{6}/, name: 'Generic timestamp pattern' },
        { pattern: /^IMG_\d{8}_\d{6}/, name: 'Camera timestamp pattern' },
        { pattern: /^VID-\d{8}-WA\d{4}/, name: 'WhatsApp video' },
        { pattern: /^\d{13}/, name: 'Unix timestamp naming' },
        { pattern: /^temp_/, name: 'Temporary file' },
        { pattern: /^bluetooth_/, name: 'Bluetooth transfer' },
        { pattern: /^xender_/, name: 'Xender transfer' },
        { pattern: /^shareit_/, name: 'ShareIt transfer' },
        { pattern: /^Copy of /, name: 'File copy' },
        { pattern: /^Edited_/, name: 'Edited file' }
    ]

    // Check screenshot and processed image patterns
    const processingPatterns = [
        { pattern: /^Screenshot/, name: 'Screenshot' },
        { pattern: /^Screen Shot/, name: 'macOS Screenshot' },
        { pattern: /^Image \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}/, name: 'macOS Screenshot (renamed)' },
        { pattern: /_[a-f0-9]{8}\./, name: 'Hash suffix (processing)' },
        { pattern: /^Untitled/, name: 'Untitled file (processing)' },
        { pattern: /^photo_\d+/, name: 'Generic photo naming' },
        { pattern: /^image_\d+/, name: 'Generic image naming' },
        { pattern: /\(1\)|\(2\)|\(3\)/, name: 'Duplicate file naming' }
    ]

    // Check transfer patterns
    transferPatterns.forEach(({ pattern, name }) => {
        if (pattern.test(fileName)) {
            transferIndicators.push(name)
        }
    })

    // Check processing patterns
    processingPatterns.forEach(({ pattern, name }) => {
        if (pattern.test(fileName)) {
            processingIndicators.push(name)
        }
    })

    // Analyze EXIF data completeness
    const exifAnalysis = analyzeExifCompleteness(exifData)
    
    // Compare file modification date with current date
    const fileDate = new Date(lastModified)
    const now = new Date()
    const daysDiff = Math.floor((now.getTime() - fileDate.getTime()) / (24 * 60 * 60 * 1000))

    // Additional indicators
    if (exifAnalysis.isMissingCriticalData) {
        processingIndicators.push('Missing critical camera EXIF data')
    }

    if (exifAnalysis.hasOnlyBasicData) {
        processingIndicators.push('Only basic JFIF data present')
    }

    if (daysDiff > 30) {
        transferIndicators.push(`File modified ${daysDiff} days ago (likely stored/transferred)`)
    }

    // Determine image source
    let imageSource = 'Unknown'
    let confidence = 'Low'

    if (processingIndicators.some(indicator => indicator.includes('Screenshot'))) {
        imageSource = 'Screenshot'
        confidence = 'High'
    } else if (processingIndicators.some(indicator => indicator.includes('processing'))) {
        imageSource = 'Processed/Edited Image'
        confidence = 'Medium'
    } else if (transferIndicators.length > 0) {
        imageSource = 'Transferred File'
        confidence = transferIndicators.length > 1 ? 'High' : 'Medium'
    } else if (exifAnalysis.hasRichCameraData) {
        imageSource = 'Original Camera Photo'
        confidence = 'High'
    }

    return {
        imageSource,
        confidence,
        likelyTransferred: transferIndicators.length > 0,
        likelyProcessed: processingIndicators.length > 0,
        transferIndicators,
        processingIndicators,
        exifAnalysis,
        fileAge: `${daysDiff} days old`
    }
}

// Analyze EXIF data completeness
function analyzeExifCompleteness(exifData) {
    if (!exifData) {
        return {
            hasRichCameraData: false,
            isMissingCriticalData: true,
            hasOnlyBasicData: false,
            dataRichness: 'No EXIF data'
        }
    }

    const keys = Object.keys(exifData)
    const criticalCameraFields = [
        'Make', 'Model', 'DateTimeOriginal', 'ExposureTime', 
        'FNumber', 'ISO', 'FocalLength'
    ]
    
    const gpsFields = ['latitude', 'longitude', 'GPSLatitude', 'GPSLongitude']
    const basicFields = ['JFIFVersion', 'ResolutionUnit', 'XResolution', 'YResolution']

    const hasCriticalData = criticalCameraFields.some(field => 
        exifData[field] !== undefined && exifData[field] !== null
    )
    
    const hasGPSData = gpsFields.some(field => 
        exifData[field] !== undefined && exifData[field] !== null
    )

    const hasOnlyBasicData = keys.length <= 6 && 
        keys.every(key => basicFields.includes(key) || key.includes('Thumbnail'))

    let dataRichness = 'Rich'
    if (hasOnlyBasicData) dataRichness = 'Basic (JFIF only)'
    else if (!hasCriticalData) dataRichness = 'Limited'
    else if (hasGPSData) dataRichness = 'Very Rich (with GPS)'

    return {
        hasRichCameraData: hasCriticalData,
        isMissingCriticalData: !hasCriticalData,
        hasOnlyBasicData,
        hasGPSData,
        dataRichness,
        totalFields: keys.length
    }
}