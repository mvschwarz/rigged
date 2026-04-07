#!/usr/bin/env node
// OpenRig Claude Status Line Context Collector
// Reads Claude status line JSON from stdin, extracts context window data,
// and writes atomically to a sidecar file.
//
// Usage: node claude-statusline-context.js <sidecar-output-path>

const fs = require("fs");
const path = require("path");

const outputPath = process.argv[2];
if (!outputPath) {
  process.exit(0); // No output path — silently exit
}

let input = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const raw = JSON.parse(input);
    const contextWindow = raw.context_window;
    if (!contextWindow) {
      process.exit(0); // No context_window in payload — skip
    }

    const sample = {
      context_window: {
        context_window_size: contextWindow.context_window_size ?? null,
        used_percentage: contextWindow.used_percentage ?? null,
        remaining_percentage: contextWindow.remaining_percentage ?? null,
        total_input_tokens: contextWindow.total_input_tokens ?? null,
        total_output_tokens: contextWindow.total_output_tokens ?? null,
        current_usage: contextWindow.current_usage ?? null,
      },
      session_id: raw.session_id ?? null,
      session_name: raw.session_name ?? null,
      transcript_path: raw.transcript_path ?? null,
      sampled_at: new Date().toISOString(),
    };

    // Atomic write: write to .tmp then rename
    const tmpPath = outputPath + ".tmp";
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(sample), "utf-8");
    fs.renameSync(tmpPath, outputPath);
  } catch {
    // Silently exit on any error — best-effort collector
    process.exit(0);
  }
});
