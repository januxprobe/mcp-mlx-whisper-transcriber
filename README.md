# MLX Whisper Transcriber MCP Server

An MCP (Model Context Protocol) server for audio and video transcription using [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper), optimized for Apple Silicon Macs.

## Features

- **Apple Silicon Optimized**: Uses MLX framework with Metal GPU acceleration
- **Multiple Models**: Support for tiny, base, small, medium, and large-v3 Whisper models
- **Video Support**: Automatically extracts audio from video files (MP4, MOV, AVI, MKV, WebM)
- **Audio Support**: MP3, WAV, OGG, FLAC, M4A
- **Auto Language Detection**: Automatically detects the spoken language

## Requirements

- macOS with Apple Silicon (M1/M2/M3/M4)
- Node.js 18+
- Python 3.10+
- ffmpeg (for video processing)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/mcp-mlx-whisper-transcriber.git
cd mcp-mlx-whisper-transcriber
```

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Set up Python virtual environment

```bash
python3 -m venv venv
source venv/bin/activate
pip install mlx-whisper
```

### 4. Install ffmpeg (if not already installed)

```bash
brew install ffmpeg
```

### 5. Configure Claude Desktop

Add to your Claude Desktop config (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mlx-whisper-transcriber": {
      "command": "node",
      "args": ["/path/to/mcp-mlx-whisper-transcriber/index.js"],
      "env": {
        "PATH": "/path/to/mcp-mlx-whisper-transcriber/venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
      }
    }
  }
}
```

Replace `/path/to/` with the actual path to your installation.

## Available Tools

### transcribe_audio

Transcribe an audio or video file.

**Parameters:**
- `file_path` (required): Absolute path to the audio/video file
- `model` (optional): Whisper model to use (default: `large-v3`)
  - `tiny` - Fastest, least accurate
  - `base` - Fast, basic accuracy
  - `small` - Balanced speed/accuracy
  - `medium` - Good accuracy
  - `large-v3` - Best accuracy (recommended for Apple Silicon with 16GB+ RAM)

### check_mlx_status

Check if MLX Whisper is installed and Metal GPU is available.

### list_audio_files

List all audio and video files in a directory.

## Models

| Model | Size | RAM Required | Speed | Accuracy |
|-------|------|--------------|-------|----------|
| tiny | ~75 MB | 1 GB | Fastest | Basic |
| base | ~150 MB | 1 GB | Fast | Good |
| small | ~500 MB | 2 GB | Medium | Better |
| medium | ~1.5 GB | 5 GB | Slow | Great |
| large-v3 | ~3 GB | 10 GB | Slowest | Best |

With Apple Silicon's unified memory, even the large-v3 model runs efficiently. If you have 16GB+ RAM, large-v3 is recommended for best results.

## Environment Variables

- `WHISPER_MODEL`: Default model to use (default: `large-v3`)

## Example Usage

Once configured, you can ask Claude:

- "Transcribe the video at /path/to/video.mp4"
- "List audio files in /path/to/folder"
- "Check if MLX Whisper is working"

## Troubleshooting

### "mlx-whisper not installed"

Make sure you activated the virtual environment and installed mlx-whisper:

```bash
source venv/bin/activate
pip install mlx-whisper
```

### "ffmpeg not found"

Install ffmpeg via Homebrew:

```bash
brew install ffmpeg
```

Make sure `/opt/homebrew/bin` is in the PATH in your MCP config.

### Timeout on first run

The first transcription with a new model will download the model weights (can be several GB for large-v3). This is normal and only happens once.

## License

MIT

## Credits

- [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) by Apple
- [OpenAI Whisper](https://github.com/openai/whisper) - Original model
- [Model Context Protocol](https://github.com/anthropics/anthropic-cookbook/tree/main/misc/model_context_protocol) by Anthropic
