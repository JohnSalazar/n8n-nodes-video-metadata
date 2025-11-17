# n8n-nodes-video-metadata

[![npm version](https://badge.fury.io/js/n8n-nodes-video-metadata.svg)](https://www.npmjs.com/package/n8n-nodes-video-metadata)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Extract video metadata using FFprobe with embedded static binaries - no external dependencies required!

## ✨ Features

- 🎬 Extract complete video metadata
- ⏱️ Get video duration
- 📐 Get video resolution
- 📦 Embedded FFprobe binary (no installation needed)
- 🚀 Fast and reliable
- 🔄 Works with any video format supported by FFmpeg

## 📦 Installation

### Community Nodes (Recommended)

1. Go to **Settings** > **Community Nodes** in your n8n instance
2. Search for `n8n-nodes-video-metadata`
3. Click **Install**

### Manual Installation
```bash
npm install n8n-nodes-video-metadata
```

## 🚀 Operations

### Extract Metadata
Extracts complete metadata including:
- Video codec, resolution, fps, bitrate
- Audio codec, sample rate, channels, bitrate
- File size, duration, format
- Stream information

### Get Duration
Returns only the video duration in multiple formats.

### Get Resolution
Returns video resolution with quality classification (4K, Full HD, HD, SD).

## 📝 Example Usage

### Basic Workflow
```
[HTTP Request] → Download video
    ↓
[Video Metadata] → Extract metadata
    ↓
[Google Sheets] → Save to spreadsheet
```

### Output Example
```json
{
  "metadata": {
    "duration": 120.5,
    "duration_formatted": "00:02:00",
    "size_mb": "15.00",
    "format": "mp4",
    "video": {
      "codec": "h264",
      "width": 1920,
      "height": 1080,
      "resolution": "1920x1080",
      "fps": 30,
      "bitrate_kbps": "985"
    },
    "audio": {
      "codec": "aac",
      "sample_rate_khz": "48.0",
      "channels": 2,
      "bitrate_kbps": "128"
    }
  }
}
```

## 🛠️ Development
```bash
# Clone repository
git clone https://github.com/seu-usuario/n8n-nodes-video-metadata.git

# Install dependencies
npm install

# Build
npm run build

# Link for local testing
npm link

# In n8n directory
npm link n8n-nodes-video-metadata
```

## 📄 License

MIT

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## 💬 Support

For issues and questions, please use the [GitHub Issues](https://github.com/seu-usuario/n8n-nodes-video-metadata/issues).