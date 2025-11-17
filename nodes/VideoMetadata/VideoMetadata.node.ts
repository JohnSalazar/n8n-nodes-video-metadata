import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from "n8n-workflow";

import { exec } from "child_process";
import { createWriteStream } from "fs";
import { unlink, writeFile } from "fs/promises";
import * as http from "http";
import * as https from "https";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const ffprobeStatic = require("ffprobe-static");

const execPromise = promisify(exec);

export class VideoMetadata implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Video Metadata",
    name: "videoMetadata",
    icon: "file:video-metadata.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"] + " - " + $parameter["inputMode"]}}',
    description: "Extract metadata from video files using FFprobe",
    defaults: {
      name: "Video Metadata",
    },
    inputs: ["main"],
    outputs: ["main"],
    properties: [
      {
        displayName: "Input Mode",
        name: "inputMode",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Binary Data",
            value: "binaryData",
            description: "Use video from binary data (from previous node)",
          },
          {
            name: "Download from URL",
            value: "url",
            description: "Download video from URL",
          },
        ],
        default: "binaryData",
        description: "How to get the video file",
      },
      {
        displayName: "Video URL",
        name: "videoUrl",
        type: "string",
        default: "",
        required: true,
        displayOptions: {
          show: {
            inputMode: ["url"],
          },
        },
        placeholder: "https://example.com/video.mp4",
        description: "URL of the video file to analyze",
      },
      {
        displayName: "Binary Property",
        name: "binaryPropertyName",
        type: "string",
        default: "data",
        required: true,
        displayOptions: {
          show: {
            inputMode: ["binaryData"],
          },
        },
        description: "Name of the binary property containing the video file",
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Extract Metadata",
            value: "extractMetadata",
            description: "Extract complete metadata from video file",
            action: "Extract metadata from video file",
          },
          {
            name: "Get Duration",
            value: "getDuration",
            description: "Get only video duration",
            action: "Get video duration",
          },
          {
            name: "Get Resolution",
            value: "getResolution",
            description: "Get video resolution (width x height)",
            action: "Get video resolution",
          },
        ],
        default: "extractMetadata",
      },
      {
        displayName: "Include Raw Output",
        name: "includeRaw",
        type: "boolean",
        default: false,
        displayOptions: {
          show: {
            operation: ["extractMetadata"],
          },
        },
        description: "Whether to include the complete raw FFprobe output",
      },
      {
        displayName: "Output Property Name",
        name: "outputPropertyName",
        type: "string",
        default: "metadata",
        description: "Name of the output property to store the metadata",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const ffprobePath = ffprobeStatic.path;

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const inputMode = this.getNodeParameter(
          "inputMode",
          itemIndex
        ) as string;
        const operation = this.getNodeParameter(
          "operation",
          itemIndex
        ) as string;
        const outputPropertyName = this.getNodeParameter(
          "outputPropertyName",
          itemIndex
        ) as string;

        let tempFilePath: string;
        let shouldCleanup = true;

        if (inputMode === "binaryData") {
          const binaryPropertyName = this.getNodeParameter(
            "binaryPropertyName",
            itemIndex
          ) as string;
          const binaryData = this.helpers.assertBinaryData(
            itemIndex,
            binaryPropertyName
          );
          const binaryDataBuffer = await this.helpers.getBinaryDataBuffer(
            itemIndex,
            binaryPropertyName
          );

          const tempFileName = `video_${Date.now()}_${Math.random()
            .toString(36)
            .substring(7)}${binaryData.fileExtension || ".mp4"}`;
          tempFilePath = join(tmpdir(), tempFileName);

          await writeFile(tempFilePath, binaryDataBuffer);
        } else {
          const videoUrl = this.getNodeParameter(
            "videoUrl",
            itemIndex
          ) as string;

          if (!videoUrl || !videoUrl.startsWith("http")) {
            throw new NodeOperationError(
              this.getNode(),
              "Invalid URL provided",
              { itemIndex }
            );
          }

          const urlExtension = getFileExtensionFromUrl(videoUrl) || ".mp4";
          const tempFileName = `video_${Date.now()}_${Math.random()
            .toString(36)
            .substring(7)}${urlExtension}`;
          tempFilePath = join(tmpdir(), tempFileName);

          await downloadFile(videoUrl, tempFilePath);
        }

        try {
          let result: any;

          switch (operation) {
            case "extractMetadata":
              result = await extractFullMetadata(
                this,
                ffprobePath,
                tempFilePath,
                itemIndex
              );
              break;

            case "getDuration":
              result = await getDuration(ffprobePath, tempFilePath);
              break;

            case "getResolution":
              result = await getResolution(ffprobePath, tempFilePath);
              break;

            default:
              throw new NodeOperationError(
                this.getNode(),
                `Operation "${operation}" is not supported`,
                { itemIndex }
              );
          }

          const outputItem: INodeExecutionData = {
            json: {
              ...items[itemIndex].json,
              [outputPropertyName]: result,
            },
            binary: items[itemIndex].binary,
          };

          returnData.push(outputItem);
        } finally {
          if (shouldCleanup) {
            try {
              await unlink(tempFilePath);
            } catch (unlinkError) {}
          }
        }
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              ...items[itemIndex].json,
              error: (error as Error).message,
            },
          });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          reject(
            new Error(`Failed to download file: HTTP ${response.statusCode}`)
          );
          return;
        }

        response.pipe(file);

        file.on("finish", () => {
          file.close();
          resolve();
        });

        file.on("error", (err) => {
          file.close();
          reject(err);
        });
      })
      .on("error", (err) => {
        file.close();
        reject(err);
      });
  });
}

function getFileExtensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
    return match ? `.${match[1]}` : null;
  } catch {
    return null;
  }
}

async function extractFullMetadata(
  context: IExecuteFunctions,
  ffprobePath: string,
  filePath: string,
  itemIndex: number
): Promise<any> {
  const includeRaw = context.getNodeParameter(
    "includeRaw",
    itemIndex
  ) as boolean;

  const command = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${filePath}"`;

  const { stdout } = await execPromise(command);
  const rawMetadata = JSON.parse(stdout);

  const videoStream = rawMetadata.streams?.find(
    (s: any) => s.codec_type === "video"
  );
  const audioStream = rawMetadata.streams?.find(
    (s: any) => s.codec_type === "audio"
  );

  let fps = null;
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split("/");
    fps = den
      ? parseFloat((parseInt(num) / parseInt(den)).toFixed(2))
      : parseFloat(num);
  }

  const durationSeconds = parseFloat(rawMetadata.format?.duration) || 0;
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = Math.floor(durationSeconds % 60);
  const durationFormatted = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  const metadata: any = {
    filename: rawMetadata.format?.filename,
    format: rawMetadata.format?.format_name,
    format_long: rawMetadata.format?.format_long_name,
    duration: durationSeconds,
    duration_formatted: durationFormatted,
    size: parseInt(rawMetadata.format?.size) || 0,
    size_mb: (
      (parseInt(rawMetadata.format?.size) || 0) /
      (1024 * 1024)
    ).toFixed(2),
    bitrate: parseInt(rawMetadata.format?.bit_rate) || 0,
    bitrate_kbps: (
      (parseInt(rawMetadata.format?.bit_rate) || 0) / 1000
    ).toFixed(0),

    video: videoStream
      ? {
          codec: videoStream.codec_name,
          codec_long: videoStream.codec_long_name,
          profile: videoStream.profile,
          width: videoStream.width,
          height: videoStream.height,
          resolution: `${videoStream.width}x${videoStream.height}`,
          aspect_ratio: videoStream.display_aspect_ratio || "N/A",
          fps: fps,
          bitrate: parseInt(videoStream.bit_rate) || null,
          bitrate_kbps: videoStream.bit_rate
            ? ((parseInt(videoStream.bit_rate) || 0) / 1000).toFixed(0)
            : null,
          pixel_format: videoStream.pix_fmt,
          level: videoStream.level,
          color_space: videoStream.color_space,
          color_range: videoStream.color_range,
        }
      : null,

    audio: audioStream
      ? {
          codec: audioStream.codec_name,
          codec_long: audioStream.codec_long_name,
          sample_rate: parseInt(audioStream.sample_rate) || null,
          sample_rate_khz: audioStream.sample_rate
            ? ((parseInt(audioStream.sample_rate) || 0) / 1000).toFixed(1)
            : null,
          channels: audioStream.channels,
          channel_layout: audioStream.channel_layout,
          bitrate: parseInt(audioStream.bit_rate) || null,
          bitrate_kbps: audioStream.bit_rate
            ? ((parseInt(audioStream.bit_rate) || 0) / 1000).toFixed(0)
            : null,
        }
      : null,

    streams_count: {
      total: rawMetadata.streams?.length || 0,
      video:
        rawMetadata.streams?.filter((s: any) => s.codec_type === "video")
          .length || 0,
      audio:
        rawMetadata.streams?.filter((s: any) => s.codec_type === "audio")
          .length || 0,
      subtitle:
        rawMetadata.streams?.filter((s: any) => s.codec_type === "subtitle")
          .length || 0,
    },
  };

  if (includeRaw) {
    metadata.raw = rawMetadata;
  }

  return metadata;
}

async function getDuration(
  ffprobePath: string,
  filePath: string
): Promise<any> {
  const command = `"${ffprobePath}" -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;

  const { stdout } = await execPromise(command);
  const durationSeconds = parseFloat(stdout.trim());

  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = Math.floor(durationSeconds % 60);
  const durationFormatted = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  return {
    duration_seconds: durationSeconds,
    duration_formatted: durationFormatted,
    hours,
    minutes,
    seconds,
  };
}

async function getResolution(
  ffprobePath: string,
  filePath: string
): Promise<any> {
  const command = `"${ffprobePath}" -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${filePath}"`;

  const { stdout } = await execPromise(command);
  const [width, height] = stdout
    .trim()
    .split("x")
    .map((v) => parseInt(v));

  let quality = "Unknown";
  if (height >= 2160) quality = "4K";
  else if (height >= 1440) quality = "2K";
  else if (height >= 1080) quality = "Full HD";
  else if (height >= 720) quality = "HD";
  else if (height >= 480) quality = "SD";
  else quality = "Low";

  return {
    width,
    height,
    resolution: `${width}x${height}`,
    quality,
    aspect_ratio: (width / height).toFixed(2),
  };
}
