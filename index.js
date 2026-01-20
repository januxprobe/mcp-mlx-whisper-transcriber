#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

// Configuration
const WHISPER_MODEL = process.env.WHISPER_MODEL || "large-v3";
const TRANSCRIBE_BASE_PATH = process.env.TRANSCRIBE_BASE_PATH || "";

// Create MCP server
const server = new Server(
  {
    name: "mlx-whisper-transcriber",
    version: "2.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper: Log with timestamp
function log(message) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${message}`);
}

// Helper: Resolve file path (handles relative paths and base path)
function resolveFilePath(inputPath) {
  // If it's already an absolute path that exists, use it
  if (path.isAbsolute(inputPath) && fs.existsSync(inputPath)) {
    return inputPath;
  }

  // If we have a base path configured, try combining with it
  if (TRANSCRIBE_BASE_PATH) {
    // Handle just filename
    const withBasePath = path.join(TRANSCRIBE_BASE_PATH, path.basename(inputPath));
    if (fs.existsSync(withBasePath)) {
      log(`Resolved "${inputPath}" to "${withBasePath}" using TRANSCRIBE_BASE_PATH`);
      return withBasePath;
    }

    // Handle relative path
    const fullPath = path.join(TRANSCRIBE_BASE_PATH, inputPath);
    if (fs.existsSync(fullPath)) {
      log(`Resolved "${inputPath}" to "${fullPath}" using TRANSCRIBE_BASE_PATH`);
      return fullPath;
    }
  }

  // Return original path (will fail with file not found if it doesn't exist)
  return inputPath;
}

// Helper: Get file size in human readable format
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Helper: Check if file is video
function isVideoFile(filePath) {
  const videoExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"];
  const ext = path.extname(filePath).toLowerCase();
  return videoExtensions.includes(ext);
}

// Helper: Extract audio from video using ffmpeg
async function extractAudio(inputPath) {
  const outputPath = inputPath.replace(/\.[^/.]+$/, "") + "_temp_audio.wav";

  log(`Extracting audio from video...`);
  log(`Input: ${inputPath}`);
  log(`Output: ${outputPath}`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", inputPath,
      "-vn",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      "-y",
      outputPath
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        log(`Audio extraction complete: ${outputPath}`);
        resolve(outputPath);
      } else {
        log(`FFmpeg failed with code ${code}`);
        reject(new Error(`ffmpeg failed: ${stderr}`));
      }
    });

    ffmpeg.on("error", (err) => {
      log(`FFmpeg error: ${err.message}`);
      reject(new Error(`ffmpeg not found. Please install ffmpeg: brew install ffmpeg`));
    });
  });
}

// Helper: Transcribe using MLX Whisper
async function transcribeWithMLX(filePath, model) {
  let audioPath = filePath;
  let tempFile = null;

  // If video, extract audio first
  if (isVideoFile(filePath)) {
    audioPath = await extractAudio(filePath);
    tempFile = audioPath;
  }

  log(`Starting MLX Whisper transcription...`);
  log(`Audio file: ${audioPath}`);
  log(`Model: mlx-community/whisper-${model}-mlx`);

  return new Promise((resolve, reject) => {
    // Use Python to run mlx_whisper
    const pythonScript = `
import sys
import json

print("Loading MLX Whisper...", file=sys.stderr)
import mlx_whisper

print("Starting transcription...", file=sys.stderr)
result = mlx_whisper.transcribe(
    "${audioPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}",
    path_or_hf_repo="mlx-community/whisper-${model}-mlx",
    verbose=True
)

print("Transcription complete!", file=sys.stderr)
print("---JSON_START---")
print(json.dumps({"success": True, "text": result["text"], "segments": result.get("segments", [])}))
`;

    const python = spawn("python3", ["-c", pythonScript]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      const msg = data.toString();
      stderr += msg;
      // Log progress to MCP stderr (visible in Claude)
      log(`[MLX] ${msg.trim()}`);
    });

    python.on("close", (code) => {
      log(`Python process exited with code ${code}`);

      // Clean up temp file
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
          log(`Cleaned up temp file: ${tempFile}`);
        } catch (e) {
          log(`Warning: Could not delete temp file: ${e.message}`);
        }
      }

      try {
        // Extract JSON from output (after the marker)
        const jsonMarker = "---JSON_START---";
        const jsonStart = stdout.indexOf(jsonMarker);
        let jsonStr;

        if (jsonStart !== -1) {
          jsonStr = stdout.substring(jsonStart + jsonMarker.length).trim();
        } else {
          // Fallback: try to find JSON object directly
          const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
          jsonStr = jsonMatch ? jsonMatch[0] : stdout.trim();
        }

        log(`Parsing JSON response...`);
        const result = JSON.parse(jsonStr);

        if (result.success) {
          log(`Successfully transcribed ${result.segments?.length || 0} segments`);
          resolve({
            text: result.text,
            segments: result.segments
          });
        } else {
          log(`Transcription failed: ${result.error}`);
          reject(new Error(result.error));
        }
      } catch (e) {
        log(`Failed to parse output: ${e.message}`);
        log(`Raw stdout: ${stdout}`);
        reject(new Error(`Failed to parse MLX output: ${e.message}\nStdout: ${stdout}\nStderr: ${stderr}`));
      }
    });

    python.on("error", (err) => {
      log(`Python error: ${err.message}`);
      // Clean up temp file
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {}
      }
      reject(new Error(`Python not found: ${err.message}`));
    });
  });
}

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const basePathInfo = TRANSCRIBE_BASE_PATH
    ? `\n\nBase path configured: ${TRANSCRIBE_BASE_PATH} (you can use just filenames)`
    : "";

  return {
    tools: [
      {
        name: "transcribe_audio",
        description:
          `Transcribe an audio or video file using MLX Whisper (optimized for Apple Silicon). Supports MP3, WAV, OGG, FLAC, M4A, MP4, MOV, AVI, MKV, WebM files.${basePathInfo}`,
        inputSchema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: TRANSCRIBE_BASE_PATH
                ? `File path or just the filename (will look in ${TRANSCRIBE_BASE_PATH})`
                : "Absolute path to the audio or video file to transcribe",
            },
            model: {
              type: "string",
              description: "Whisper model to use: tiny, base, small, medium, large-v3 (default: large-v3)",
              enum: ["tiny", "base", "small", "medium", "large-v3"],
            },
          },
          required: ["file_path"],
        },
      },
      {
        name: "check_mlx_status",
        description: "Check if MLX Whisper is installed and ready",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_audio_files",
        description: TRANSCRIBE_BASE_PATH
          ? `List audio and video files. Defaults to ${TRANSCRIBE_BASE_PATH} if no directory specified.`
          : "List audio and video files in a directory",
        inputSchema: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: TRANSCRIBE_BASE_PATH
                ? `Directory path (defaults to ${TRANSCRIBE_BASE_PATH})`
                : "Directory path to scan for audio/video files",
            },
          },
          required: TRANSCRIBE_BASE_PATH ? [] : ["directory"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log(`Tool called: ${name}`);
  log(`Arguments: ${JSON.stringify(args)}`);
  if (TRANSCRIBE_BASE_PATH) {
    log(`Base path: ${TRANSCRIBE_BASE_PATH}`);
  }

  try {
    switch (name) {
      case "transcribe_audio": {
        const inputPath = args.file_path;
        const model = args.model || WHISPER_MODEL;

        log(`=== Starting Transcription ===`);
        log(`Input path: ${inputPath}`);
        log(`Model: ${model}`);

        // Resolve the file path
        const filePath = resolveFilePath(inputPath);
        log(`Resolved path: ${filePath}`);

        // Validate file exists
        if (!fs.existsSync(filePath)) {
          log(`Error: File not found`);
          const suggestion = TRANSCRIBE_BASE_PATH
            ? `\n\nTip: Files should be in ${TRANSCRIBE_BASE_PATH} or provide a full path.`
            : "";
          return {
            content: [
              {
                type: "text",
                text: `Error: File not found: ${filePath}${suggestion}`,
              },
            ],
          };
        }

        // Get file info
        const stats = fs.statSync(filePath);
        const fileSize = formatFileSize(stats.size);
        const fileName = path.basename(filePath);

        log(`File size: ${fileSize}`);
        log(`File name: ${fileName}`);

        // Transcribe
        const result = await transcribeWithMLX(filePath, model);

        log(`=== Transcription Complete ===`);
        log(`Text length: ${result.text.length} characters`);

        return {
          content: [
            {
              type: "text",
              text: `## Transcription of ${fileName}\n\n**File size:** ${fileSize}\n**Model:** whisper-${model}-mlx\n\n---\n\n${result.text}`,
            },
          ],
        };
      }

      case "check_mlx_status": {
        log(`Checking MLX Whisper status...`);

        return new Promise((resolve) => {
          const pythonScript = `
import json
try:
    import mlx_whisper
    import mlx.core as mx

    # Check Metal availability
    metal_available = mx.metal.is_available()

    print(json.dumps({
        "success": True,
        "mlx_whisper_version": getattr(mlx_whisper, "__version__", "installed"),
        "metal_available": metal_available
    }))
except ImportError as e:
    print(json.dumps({
        "success": False,
        "error": f"mlx-whisper not installed: {str(e)}"
    }))
except Exception as e:
    print(json.dumps({
        "success": False,
        "error": str(e)
    }))
`;

          const python = spawn("python3", ["-c", pythonScript]);
          let stdout = "";

          python.stdout.on("data", (data) => {
            stdout += data.toString();
          });

          python.on("close", () => {
            try {
              const result = JSON.parse(stdout.trim());
              const basePathStatus = TRANSCRIBE_BASE_PATH
                ? `\n**Base path:** ${TRANSCRIBE_BASE_PATH}`
                : "\n**Base path:** Not configured (use full paths)";

              if (result.success) {
                log(`MLX Whisper is ready. Metal: ${result.metal_available}`);
                resolve({
                  content: [
                    {
                      type: "text",
                      text: `## MLX Whisper Status\n\n✅ **MLX Whisper installed**\n\n**Metal GPU:** ${result.metal_available ? "✅ Available" : "❌ Not available"}\n**Default model:** whisper-${WHISPER_MODEL}-mlx${basePathStatus}\n\n**Available models:**\n- tiny (fastest, least accurate)\n- base\n- small\n- medium\n- large-v3 (slowest, most accurate)\n\n**Tip:** With 128GB unified memory, large-v3 runs smoothly!`,
                    },
                  ],
                });
              } else {
                log(`MLX Whisper not ready: ${result.error}`);
                resolve({
                  content: [
                    {
                      type: "text",
                      text: `## MLX Whisper Status\n\n❌ **Not ready**\n\n**Error:** ${result.error}\n\n**To install:**\n\`\`\`bash\npip install mlx-whisper\n\`\`\``,
                    },
                  ],
                });
              }
            } catch (e) {
              log(`Error checking status: ${e.message}`);
              resolve({
                content: [
                  {
                    type: "text",
                    text: `## MLX Whisper Status\n\n❌ **Error checking status**\n\n${e.message}\n\nOutput: ${stdout}`,
                  },
                ],
              });
            }
          });

          python.on("error", () => {
            log(`Python not found`);
            resolve({
              content: [
                {
                  type: "text",
                  text: `## MLX Whisper Status\n\n❌ **Python not found**\n\nMake sure Python 3 is installed and in your PATH.`,
                },
              ],
            });
          });
        });
      }

      case "list_audio_files": {
        // Use provided directory or fall back to base path
        const directory = args.directory || TRANSCRIBE_BASE_PATH;

        if (!directory) {
          return {
            content: [
              {
                type: "text",
                text: `Error: No directory specified and TRANSCRIBE_BASE_PATH is not configured.`,
              },
            ],
          };
        }

        log(`Listing audio files in: ${directory}`);

        if (!fs.existsSync(directory)) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Directory not found: ${directory}`,
              },
            ],
          };
        }

        const audioExtensions = [
          ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".webm",
          ".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv"
        ];

        const files = fs.readdirSync(directory)
          .filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return audioExtensions.includes(ext);
          })
          .map((file) => {
            const filePath = path.join(directory, file);
            const stats = fs.statSync(filePath);
            return `- **${file}** (${formatFileSize(stats.size)})`;
          });

        log(`Found ${files.length} audio/video files`);

        if (files.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No audio or video files found in: ${directory}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `## Audio/Video files in ${directory}\n\n${files.join("\n")}`,
            },
          ],
        };
      }

      default:
        log(`Unknown tool: ${name}`);
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
        };
    }
  } catch (error) {
    log(`Error: ${error.message}`);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MLX Whisper Transcriber MCP server started");
  if (TRANSCRIBE_BASE_PATH) {
    log(`Base path configured: ${TRANSCRIBE_BASE_PATH}`);
  }
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
