# Claude Code Context

This file provides context for Claude Code when working on this project.

## Project Overview

This is an MCP (Model Context Protocol) server that provides audio/video transcription capabilities using MLX Whisper, optimized for Apple Silicon Macs.

## Architecture

```
mcp-mlx-whisper-transcriber/
├── index.js          # Main MCP server (Node.js)
├── package.json      # Node.js dependencies
├── venv/             # Python virtual environment (not in git)
├── README.md         # User documentation
├── CLAUDE.md         # This file - Claude Code context
└── .gitignore        # Git ignore rules
```

## How It Works

1. **MCP Server (Node.js)**: `index.js` implements the MCP protocol using `@modelcontextprotocol/sdk`
2. **Audio Extraction**: Uses `ffmpeg` (spawned as child process) to extract audio from video files
3. **Transcription**: Spawns Python to run `mlx_whisper.transcribe()` with the specified model
4. **Communication**: Results returned as JSON, parsed by Node.js, and sent back via MCP

## Key Components

### index.js

- `resolveFilePath()`: Resolves file paths using TRANSCRIBE_BASE_PATH if configured
- `transcribeWithMLX()`: Main transcription function
  - Extracts audio from video if needed (via ffmpeg)
  - Spawns Python with inline script to run mlx_whisper
  - Uses `---JSON_START---` marker to separate logs from JSON output
  - Cleans up temp audio files after transcription

- MCP Tools:
  - `transcribe_audio`: Main transcription tool
  - `check_mlx_status`: Verifies MLX Whisper installation
  - `list_audio_files`: Lists media files in a directory

### Environment Variables

- `WHISPER_MODEL`: Default model (default: `large-v3`)
- `TRANSCRIBE_BASE_PATH`: Default folder for audio/video files (enables filename-only usage)

### Dependencies

**Node.js** (package.json):
- `@modelcontextprotocol/sdk`: MCP protocol implementation

**Python** (venv):
- `mlx-whisper`: Apple Silicon optimized Whisper implementation

**System**:
- `ffmpeg`: Audio/video processing

## Development Notes

### Adding New Features

1. New tools should be added in `ListToolsRequestSchema` handler
2. Tool implementation goes in `CallToolRequestSchema` handler
3. Use `log()` helper for consistent logging with timestamps

### Python Integration

The Python script is embedded as a string in Node.js and spawned with `python3 -c`. This avoids needing separate Python files while keeping the project simple.

To modify the Python transcription logic, edit the `pythonScript` template string in `transcribeWithMLX()`.

### Path Resolution

The `resolveFilePath()` function handles path resolution:
1. If absolute path exists, use it directly
2. If `TRANSCRIBE_BASE_PATH` is set, try combining with filename
3. Return original path (will fail with file not found if invalid)

### Model Selection

Models are downloaded from Hugging Face (`mlx-community/whisper-{model}-mlx`) on first use. The model cache is managed by the `huggingface_hub` library.

### Error Handling

- File not found errors return user-friendly messages with hints about base path
- Python errors are captured from stderr and logged
- JSON parsing failures include raw output for debugging

## Testing

To test locally:

```bash
# Start the server manually
node index.js

# Or test with MCP inspector
npx @modelcontextprotocol/inspector node index.js
```

## Common Issues

1. **PATH issues**: The MCP server needs ffmpeg and Python in PATH. Configure via `env.PATH` in Claude Desktop config.

2. **Virtual environment**: Python must use the venv with mlx-whisper installed. Put venv/bin first in PATH.

3. **Timeouts**: Large model downloads can timeout. The model is cached after first download.

4. **File not found in Cowork**: When using Cowork (Claude Desktop's VM mode), the VM has different paths than the Mac. Configure `TRANSCRIBE_BASE_PATH` to the Mac path so the MCP server (which runs on the Mac) can find files.

## MCP Configuration

Example Claude Desktop config:

```json
{
  "mcpServers": {
    "mlx-whisper-transcriber": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": {
        "PATH": "/path/to/venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        "WHISPER_MODEL": "large-v3",
        "TRANSCRIBE_BASE_PATH": "/path/to/audio/files"
      }
    }
  }
}
```

## Version History

- **2.1.0**: Added `TRANSCRIBE_BASE_PATH` support for easier file access
- **2.0.0**: Switched from Ollama to MLX Whisper for native Apple Silicon support
- **1.0.0**: Initial release with Ollama-based transcription
