import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demo = path.join(root, "demo");
const outputFile = path.join(demo, "final.mp4");
const MAX_DURATION_SECONDS = 175;
const fps = 30;
const audioRate = 48_000;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} exited with code ${result.status}`);
  }
  return result.stdout.trim();
}

function probe(file) {
  const raw = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,duration",
    "-of", "json",
    file,
  ]);
  const info = JSON.parse(raw);
  const duration = Number(info.format?.duration ?? info.streams?.find((stream) => stream.codec_type === "video")?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine duration for ${file}`);
  return { duration, hasAudio: info.streams?.some((stream) => stream.codec_type === "audio") ?? false };
}

function escapeConcatPath(file) {
  return path.resolve(file).replaceAll("\\", "/").replaceAll("'", "'\\''");
}

function imageFilter(subtitle = false) {
  const base = `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`;
  return subtitle
    ? `${base},drawtext=text='Sample data shown for demonstration':fontcolor=white:fontsize=32:box=1:boxcolor=black@0.78:boxborderw=16:x=(w-text_w)/2:y=h-110`
    : base;
}

function makeImageSegment(image, duration, output, subtitle = false) {
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-loop", "1", "-framerate", String(fps), "-i", image,
    "-f", "lavfi", "-t", String(duration), "-i", `anullsrc=r=${audioRate}:cl=stereo`,
    "-t", String(duration),
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", imageFilter(subtitle),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", String(audioRate), "-ac", "2",
    output,
  ]);
}

function makeClipSegment(clip, output, duration, hasAudio) {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", clip];
  if (!hasAudio) args.push("-f", "lavfi", "-t", String(duration), "-i", `anullsrc=r=${audioRate}:cl=stereo`);
  args.push(
    "-t", String(duration),
    "-map", "0:v:0",
    "-map", hasAudio ? "0:a:0" : "1:a:0",
    "-vf", `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS,format=yuv420p`,
    ...(hasAudio ? ["-af", `apad,atrim=duration=${duration},asetpts=PTS-STARTPTS`] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", String(audioRate), "-ac", "2",
    output,
  );
  run("ffmpeg", args);
}

async function main() {
  run("ffmpeg", ["-version"]);
  run("ffprobe", ["-version"]);
  await mkdir(demo, { recursive: true });

  const stills = [
    { file: "cards/01-title.png", duration: 4 },
    { file: "cards/02-problem.png", duration: 8 },
    { file: "frames/overlay-1.png", duration: 4, subtitle: true },
    { file: "frames/overlay-2.png", duration: 4, subtitle: true },
    { file: "cards/03-how-it-works.png", duration: 12 },
    { file: "cards/04-closing.png", duration: 6 },
  ];
  const missingStills = stills.map(({ file }) => path.join(demo, file)).filter((file) => !existsSync(file));
  if (missingStills.length) {
    throw new Error(`Missing required card/frame image(s): ${missingStills.map((file) => path.relative(root, file)).join(", ")}`);
  }

  const sequence = [];
  let estimatedDuration = stills.reduce((total, still) => total + still.duration, 0);
  for (const clipName of ["live.mp4", "codex.mp4"]) {
    const clip = path.join(demo, clipName);
    if (!existsSync(clip)) {
      console.warn(`Warning: ${path.relative(root, clip)} is missing; skipping it.`);
      continue;
    }
    const details = probe(clip);
    estimatedDuration += details.duration;
    sequence.push({ type: "clip", clip, ...details });
  }

  if (estimatedDuration > MAX_DURATION_SECONDS) {
    console.log(`Total duration: ${estimatedDuration.toFixed(2)} seconds`);
    throw new Error(`Video exceeds the ${MAX_DURATION_SECONDS}-second limit.`);
  }

  const voiceover = path.join(demo, "voiceover.wav");
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "catchup-video-"));
  const segments = [];
  try {
    for (const item of [
      stills[0],
      stills[1],
      sequence.find((entry) => entry.clip.endsWith("live.mp4")),
      stills[2],
      stills[3],
      stills[4],
      sequence.find((entry) => entry.clip.endsWith("codex.mp4")),
      stills[5],
    ].filter(Boolean)) {
      const output = path.join(tempDirectory, `segment-${String(segments.length + 1).padStart(2, "0")}.mp4`);
      if (item.type === "clip") {
        makeClipSegment(item.clip, output, item.duration, item.hasAudio);
      } else {
        makeImageSegment(path.join(demo, item.file), item.duration, output, item.subtitle);
      }
      segments.push(output);
    }

    const concatList = path.join(tempDirectory, "segments.txt");
    await writeFile(concatList, segments.map((file) => `file '${escapeConcatPath(file)}'`).join("\n"), "utf8");
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatList];
    const hasVoiceover = existsSync(voiceover);
    if (hasVoiceover) args.push("-i", voiceover);
    args.push("-map", "0:v:0");
    if (hasVoiceover) {
      args.push(
        "-filter_complex", "[0:a:0][1:a:0]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
        "-map", "[aout]",
      );
    } else {
      args.push("-map", "0:a:0");
    }
    args.push(
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(fps),
      "-c:a", "aac", "-b:a", "192k", "-ar", String(audioRate), "-ac", "2", "-movflags", "+faststart", outputFile,
    );
    run("ffmpeg", args);

    const { duration } = probe(outputFile);
    console.log(`Total duration: ${duration.toFixed(2)} seconds`);
    if (duration > MAX_DURATION_SECONDS) {
      await rm(outputFile, { force: true });
      throw new Error(`Video exceeds the ${MAX_DURATION_SECONDS}-second limit.`);
    }
    if (hasVoiceover) console.log("Mixed demo/voiceover.wav into the video.");
    console.log(`Created ${path.relative(root, outputFile)} (1920x1080, 30fps, H.264, AAC).`);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Video build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
