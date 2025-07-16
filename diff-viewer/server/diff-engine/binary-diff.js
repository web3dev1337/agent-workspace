const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class BinaryDiffEngine {
  constructor() {
    // Common binary file extensions
    this.binaryExtensions = new Set([
      // Images
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.ico', '.webp',
      // Documents
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      // Archives
      '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
      // Media
      '.mp3', '.mp4', '.avi', '.mov', '.wav', '.flac', '.mkv',
      // Executables
      '.exe', '.dll', '.so', '.dylib', '.app',
      // Data
      '.db', '.sqlite', '.dat', '.bin',
      // Fonts
      '.ttf', '.otf', '.woff', '.woff2',
      // Models
      '.h5', '.pkl', '.pt', '.onnx', '.pb'
    ]);

    // Metadata extractors for different file types
    this.metadataExtractors = {
      image: this.extractImageMetadata.bind(this),
      document: this.extractDocumentMetadata.bind(this),
      archive: this.extractArchiveMetadata.bind(this),
      media: this.extractMediaMetadata.bind(this),
      model: this.extractModelMetadata.bind(this),
      default: this.extractDefaultMetadata.bind(this)
    };
  }

  isBinary(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.binaryExtensions.has(ext);
  }

  getFileType(filename) {
    const ext = path.extname(filename).toLowerCase();
    
    // Image files
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'].includes(ext)) {
      return 'image';
    }
    
    // Document files
    if (['.pdf', '.doc', '.docx', '.xls', '.xlsx'].includes(ext)) {
      return 'document';
    }
    
    // Archive files
    if (['.zip', '.tar', '.gz', '.7z', '.rar'].includes(ext)) {
      return 'archive';
    }
    
    // Media files
    if (['.mp3', '.mp4', '.avi', '.mov', '.wav'].includes(ext)) {
      return 'media';
    }
    
    // Model files
    if (['.h5', '.pkl', '.pt', '.onnx', '.pb'].includes(ext)) {
      return 'model';
    }
    
    return 'default';
  }

  async computeBinaryDiff(oldContent, newContent, filename) {
    const fileType = this.getFileType(filename);
    
    // Calculate basic metrics
    const oldSize = Buffer.byteLength(oldContent);
    const newSize = Buffer.byteLength(newContent);
    const sizeDiff = newSize - oldSize;
    const sizeChangePercent = oldSize > 0 ? (sizeDiff / oldSize) * 100 : 100;

    // Calculate hashes
    const oldHash = this.calculateHash(oldContent);
    const newHash = this.calculateHash(newContent);
    const hasChanged = oldHash !== newHash;

    // Extract type-specific metadata
    const extractor = this.metadataExtractors[fileType] || this.metadataExtractors.default;
    const oldMetadata = await extractor(oldContent, filename);
    const newMetadata = await extractor(newContent, filename);

    // Compare metadata
    const metadataChanges = this.compareMetadata(oldMetadata, newMetadata);

    return {
      fileType,
      hasChanged,
      oldSize,
      newSize,
      sizeDiff,
      sizeChangePercent: sizeChangePercent.toFixed(2),
      oldHash,
      newHash,
      oldMetadata,
      newMetadata,
      metadataChanges,
      summary: this.generateSummary(fileType, sizeDiff, metadataChanges)
    };
  }

  calculateHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  async extractImageMetadata(content, filename) {
    const metadata = {
      type: 'image',
      size: Buffer.byteLength(content)
    };

    // For images, we can extract dimensions if we have image processing tools
    // This is a simplified version - in production, you'd use sharp or similar
    try {
      // PNG dimensions (simplified)
      if (filename.endsWith('.png')) {
        const buffer = Buffer.from(content);
        if (buffer.length > 24) {
          metadata.width = buffer.readUInt32BE(16);
          metadata.height = buffer.readUInt32BE(20);
        }
      }
      // JPEG dimensions would require more complex parsing
    } catch (error) {
      // Ignore errors in metadata extraction
    }

    return metadata;
  }

  async extractDocumentMetadata(content, filename) {
    return {
      type: 'document',
      size: Buffer.byteLength(content),
      extension: path.extname(filename)
    };
  }

  async extractArchiveMetadata(content, filename) {
    const metadata = {
      type: 'archive',
      size: Buffer.byteLength(content),
      format: path.extname(filename).substring(1)
    };

    // Could use node-7z or similar to extract file count
    // This is placeholder logic
    return metadata;
  }

  async extractMediaMetadata(content, filename) {
    return {
      type: 'media',
      size: Buffer.byteLength(content),
      format: path.extname(filename).substring(1)
    };
  }

  async extractModelMetadata(content, filename) {
    const metadata = {
      type: 'model',
      size: Buffer.byteLength(content),
      format: path.extname(filename).substring(1)
    };

    // For ML models, we could extract framework info
    // This is simplified
    if (filename.endsWith('.h5')) {
      metadata.framework = 'keras/tensorflow';
    } else if (filename.endsWith('.pt')) {
      metadata.framework = 'pytorch';
    } else if (filename.endsWith('.onnx')) {
      metadata.framework = 'onnx';
    }

    return metadata;
  }

  async extractDefaultMetadata(content, filename) {
    return {
      type: 'binary',
      size: Buffer.byteLength(content),
      extension: path.extname(filename)
    };
  }

  compareMetadata(oldMeta, newMeta) {
    const changes = [];

    // Compare each field
    Object.keys(oldMeta).forEach(key => {
      if (oldMeta[key] !== newMeta[key]) {
        changes.push({
          field: key,
          oldValue: oldMeta[key],
          newValue: newMeta[key]
        });
      }
    });

    // Check for new fields
    Object.keys(newMeta).forEach(key => {
      if (!(key in oldMeta)) {
        changes.push({
          field: key,
          oldValue: undefined,
          newValue: newMeta[key]
        });
      }
    });

    return changes;
  }

  generateSummary(fileType, sizeDiff, metadataChanges) {
    const parts = [];

    // Size change
    if (sizeDiff > 0) {
      parts.push(`Size increased by ${this.formatBytes(sizeDiff)}`);
    } else if (sizeDiff < 0) {
      parts.push(`Size decreased by ${this.formatBytes(Math.abs(sizeDiff))}`);
    } else {
      parts.push('Size unchanged');
    }

    // Type-specific summaries
    switch (fileType) {
      case 'image':
        const dimChange = metadataChanges.find(c => c.field === 'width' || c.field === 'height');
        if (dimChange) {
          parts.push('Image dimensions changed');
        }
        break;
      
      case 'model':
        parts.push('Model file updated');
        break;
      
      case 'archive':
        parts.push('Archive contents may have changed');
        break;
    }

    // Metadata changes
    if (metadataChanges.length > 0) {
      parts.push(`${metadataChanges.length} metadata field(s) changed`);
    }

    return parts.join('. ');
  }

  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Math.abs(bytes);
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  // Generate a visual representation for the UI
  formatBinaryDiff(binaryDiff) {
    const { fileType, hasChanged, sizeDiff, metadataChanges } = binaryDiff;

    if (!hasChanged) {
      return {
        type: 'binary',
        status: 'unchanged',
        message: 'Binary file is identical'
      };
    }

    return {
      type: 'binary',
      status: 'changed',
      fileType,
      changes: [
        {
          label: 'File Size',
          oldValue: this.formatBytes(binaryDiff.oldSize),
          newValue: this.formatBytes(binaryDiff.newSize),
          diff: sizeDiff > 0 ? `+${this.formatBytes(sizeDiff)}` : this.formatBytes(sizeDiff),
          changeType: sizeDiff > 0 ? 'increase' : sizeDiff < 0 ? 'decrease' : 'none'
        },
        {
          label: 'SHA-256 (partial)',
          oldValue: binaryDiff.oldHash,
          newValue: binaryDiff.newHash,
          changeType: 'modified'
        },
        ...metadataChanges.map(change => ({
          label: this.formatFieldName(change.field),
          oldValue: change.oldValue || 'N/A',
          newValue: change.newValue || 'N/A',
          changeType: 'modified'
        }))
      ],
      summary: binaryDiff.summary
    };
  }

  formatFieldName(field) {
    return field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1');
  }
}

module.exports = BinaryDiffEngine;