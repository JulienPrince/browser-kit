#!/usr/bin/env node
// Which browser tools are available here, and how to install the missing ones.
// --json prints a machine-readable result. Exit code 0 always (it's a report).

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { findAllPlaywrights, launch } from "./lib/playwright.mjs";

const home = homedir();
const isWin = platform() === "win32";

/** Find an executable on PATH without a shell (works on macOS, Linux and Windows). */
export function which(cmd, path = process.env.PATH || "") {
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = join(dir, cmd + ext);
      try {
        if (statSync(file).isFile()) return file;
      } catch {}
    }
  }
  return null;
}

const byVersionDesc = (a, b) => {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
};

function devBrowserBin() {
  const onPath = which("dev-browser");
  if (onPath) return onPath;
  // nvm installs global CLIs per Node version, often missing from non-interactive PATHs.
  const nvm = join(process.env.NVM_DIR || join(home, ".nvm"), "versions", "node");
  try {
    for (const v of readdirSync(nvm).sort(byVersionDesc)) {
      const bin = join(nvm, v, "bin", "dev-browser");
      if (existsSync(bin)) return bin;
    }
  } catch {}
  return null;
}

/** Where zenpilot is registered as an MCP server, if anywhere we can see. */
function zenpilotRegistration(cwd = process.cwd()) {
  const configDirs = [process.env.CLAUDE_CONFIG_DIR, join(home, ".claude")].filter(Boolean);
  const files = [...new Set([...configDirs.map((d) => join(d, ".claude.json")), join(home, ".claude.json")])];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(f, "utf8"));
      if (data.mcpServers?.zenpilot) return `${f} (user)`;
      for (const [project, conf] of Object.entries(data.projects || {})) {
        if (conf?.mcpServers?.zenpilot) return `${f} (project ${project})`;
      }
    } catch {}
  }
  try {
    if (JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8")).mcpServers?.zenpilot) return `${join(cwd, ".mcp.json")}`;
  } catch {}
  return null;
}

export async function check({ launchBrowser = true } = {}) {
  const out = {};
  const [major] = process.versions.node.split(".").map(Number);
  out.node = { ok: major >= 18, version: process.versions.node, fix: major >= 18 ? null : "Install Node 18 or newer." };

  try {
    const installs = findAllPlaywrights();
    const first = installs[0];
    out.playwright = { ok: true, version: first.version, source: first.source, use: "netcheck.mjs, mock.mjs (network report, mocks, injected scripts)" };
    if (launchBrowser) {
      try {
        const { browser, found } = await launch(installs, { browser: "chromium", timeout: 15000 });
        await browser.close();
        Object.assign(out.playwright, { version: found.version, source: found.source });
      } catch (e) {
        // eslint-disable-next-line no-control-regex
        const msg = String(e.message).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 400);
        Object.assign(out.playwright, { ok: false, fix: msg });
      }
    }
  } catch (e) {
    out.playwright = { ok: false, fix: e.message, use: "netcheck.mjs, mock.mjs" };
  }

  const db = devBrowserBin();
  out.devBrowser = {
    ok: Boolean(db), path: db,
    fix: db ? null : "npm i -g dev-browser && dev-browser install",
    use: "local app checks, scripted flows, screenshots",
  };

  const zp = which("zenpilot") || (existsSync(join(home, ".local/bin/zenpilot")) ? join(home, ".local/bin/zenpilot") : null);
  const zen = ["/Applications/Zen.app", join(home, "Applications/Zen.app")].find((p) => existsSync(p)) || null;
  const reg = zp ? zenpilotRegistration() : null;
  out.zenpilot = {
    ok: Boolean(zp && zen), path: zp, zenBrowser: zen, registeredIn: reg,
    fix: platform() !== "darwin"
      ? "zenpilot is macOS-only; use dev-browser for visual checks."
      : !zen
        ? "Install Zen Browser (https://zen-browser.app), then zenpilot."
        : !zp
          ? "uv tool install git+https://github.com/JulienPrince/zenpilot@v0.5.1-jp2 && zenpilot setup --profile zenpilot"
          : null,
    note: zp && !reg
      ? `Not found in Claude's config files; if Claude has no mcp__zenpilot__* tools, run: claude mcp add --scope user zenpilot -- ${zp}`
      : undefined,
    use: "visual checks on real sites in the user's own browser (macOS + Zen)",
  };
  return out;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (direct) {
  const result = await check();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const [name, r] of Object.entries(result)) {
      const detail = [r.version, r.source, r.path].filter(Boolean).join(", ");
      console.log(`${r.ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}${r.use ? ` — ${r.use}` : ""}`);
      if (!r.ok && r.fix) console.log(`    fix: ${r.fix}`);
      if (r.note) console.log(`    note: ${r.note}`);
    }
  }
}
