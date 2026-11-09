import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

const API_BASE = (process.env.OPENCOMPUTER_API_URL || "https://app.opencomputer.dev").replace(/\/+$/, "");
const API_KEY = process.env.OPENCOMPUTER_API_KEY?.trim();
const AGENT_ID = process.env.OC_AGENT_ID?.trim() || "shipvideo@production";
const MODE = process.env.VIDEO_MODE === "url" ? "url" : "prompt";
const RAW_INPUT = process.env.VIDEO_INPUT || "";
const RUN_ID = process.env.GITHUB_RUN_ID || randomUUID().replaceAll("-", "");
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT || "1";
const JOB_ID = `gh${RUN_ID}a${RUN_ATTEMPT}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
const OUTPUT_DIR = resolve(process.env.OUTPUT_DIR || "output/mobile");
const API_TIMEOUT_MS = 30_000;
const JOB_TIMEOUT_MS = 30 * 60_000;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function validateConfig() {
  if (!API_KEY) throw new Error("Missing GitHub Actions secret OPENCOMPUTER_API_KEY.");
  const apiUrl = new URL(API_BASE);
  if (apiUrl.protocol !== "https:" && apiUrl.hostname !== "localhost" && apiUrl.hostname !== "127.0.0.1") {
    throw new Error("OPENCOMPUTER_API_URL must use HTTPS.");
  }
  if (!AGENT_ID.includes("@")) throw new Error("OC_AGENT_ID must include an environment, e.g. shipvideo@production.");
  let input = RAW_INPUT.replace(/\s+/g, " ").trim();
  if (!input) throw new Error("Enter a URL or a video brief in the workflow input.");
  if (input.length > 2000) throw new Error("Input is too long (maximum 2,000 characters).");
  if (MODE === "url") {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP(S) URLs are supported.");
    input = url.toString();
  }
  return input;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      "x-api-key": API_KEY,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (options.allow404 && response.status === 404) return null;
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenComputer request failed (${response.status}) at ${path}: ${bodyText.slice(0, 500)}`);
  }
  return bodyText ? JSON.parse(bodyText) : {};
}

async function readEvents(sessionId, after) {
  const result = await api(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`);
  return Array.isArray(result.events) ? result.events : [];
}

async function waitForRuntime(sessionId) {
  const deadline = Date.now() + 90_000;
  let cursor = 0;

  while (Date.now() < deadline) {
    const batch = await readEvents(sessionId, cursor);
    for (const event of batch) {
      cursor = Math.max(cursor, Number(event.seq) || cursor);
      if (event.type === "runtime.connected") {
        console.log("OpenComputer runtime is ready.");
        return cursor;
      }
      if (event.type === "runtime.disconnected") {
        throw new Error(String(event.data?.reason || "OpenComputer runtime disconnected before starting."));
      }
    }
    await sleep(1_000);
  }
  throw new Error("OpenComputer runtime did not become ready within 90 seconds.");
}

async function requestVideo(sessionId, jobId) {
  return api(
    `/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/workspace/download`,
    { method: "POST", body: { path: `videos/${jobId}.mp4` }, allow404: true },
  );
}

async function downloadVideo(download, sessionId, input) {
  if (!download?.url) throw new Error("OpenComputer did not return a signed video URL.");
  const url = new URL(download.url, API_BASE);
  if (url.protocol !== "https:") throw new Error("The signed video URL must use HTTPS.");

  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Could not download the MP4 (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000) throw new Error("The generated MP4 is unexpectedly small.");

  await mkdir(OUTPUT_DIR, { recursive: true });
  const videoPath = resolve(OUTPUT_DIR, "video.mp4");
  await writeFile(videoPath, bytes);

  const metadata = {
    jobId: JOB_ID,
    sessionId,
    agentId: AGENT_ID,
    mode: MODE,
    input,
    createdAt: new Date().toISOString(),
    video: {
      path: "video.mp4",
      bytes: bytes.length,
      expectedBytes: Number(download.size) || null,
      mediaType: download.mediaType || "video/mp4",
    },
  };
  await writeFile(resolve(OUTPUT_DIR, "job.json"), JSON.stringify(metadata, null, 2) + "\n");
  console.log(`Video saved: ${videoPath} (${bytes.length} bytes)`);
}

async function main() {
  const input = validateConfig();
  const { session } = await api("/api/managed-agents/sessions", {
    method: "POST",
    body: { agentId: AGENT_ID },
  });
  if (!session?.id) throw new Error("OpenComputer did not return a session ID.");
  const sessionId = session.id;
  console.log(`Created OpenComputer session for ${AGENT_ID}.`);

  try {
    let cursor = await waitForRuntime(sessionId);
    const jobText = [
      "JOB",
      `job_id: ${JOB_ID}`,
      `mode: ${MODE}`,
      `input: ${input}`,
      "",
      MODE === "url" ? "Create the launch video now. Start by fetching the URL." : "Create the launch video now. Follow the brief closely and fill gaps with taste.",
    ].join("\n");

    await api(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: { input: jobText, idempotencyKey: `github-actions:${RUN_ID}:${RUN_ATTEMPT}` },
    });
    console.log("Video request sent. Waiting for the renderer to finish...");

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let completedAt = 0;
    let runtimeDisconnected = false;

    while (Date.now() < deadline) {
      const batch = await readEvents(sessionId, cursor);
      for (const event of batch) {
        cursor = Math.max(cursor, Number(event.seq) || cursor);
        if (event.type === "tool.started") {
          const tool = String(event.data?.tool || "");
          if (tool) console.log(`Agent step: ${tool}`);
        }
        if (event.type === "turn.failed") {
          throw new Error(String(event.data?.message || "The ShipVideo agent failed."));
        }
        if (event.type === "turn.completed" && !completedAt) {
          completedAt = Date.now();
          console.log("Agent finished. Checking the MP4 in the session workspace...");
        }
        if (event.type === "runtime.disconnected") runtimeDisconnected = true;
      }

      const download = await requestVideo(sessionId, JOB_ID);
      if (download) {
        await downloadVideo(download, sessionId, input);
        return;
      }

      if (runtimeDisconnected && !completedAt) {
        throw new Error("OpenComputer runtime disconnected before the video was saved.");
      }
      if (completedAt && Date.now() - completedAt > 90_000) {
        throw new Error("The agent completed, but the MP4 was not found in its workspace after 90 seconds.");
      }
      await sleep(3_000);
    }

    throw new Error("Video generation timed out after 30 minutes. Check the OpenComputer session logs.");
  } finally {
    await api(`/api/managed-agents/sessions/${encodeURIComponent(sessionId)}/end`, { method: "POST" }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
