#!/usr/bin/env node

/**
 * MCP stdio shim for AMTS.
 *
 * This process speaks MCP over stdio (JSON-RPC 2.0) and forwards
 * tool/resource/prompt calls to the AMTS HTTP service.
 */

const AMTS_BASE_URL = process.env.AMTS_BASE_URL || "http://127.0.0.1:4317";
const SHIM_CWD = process.cwd();

const readline = require("readline");
const http = require("http");
const url = require("url");

const rl = readline.createInterface({ input: process.stdin, terminal: false });

let toolsCache = null;
let resourcesCache = null;
let promptsCache = null;

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(`${msg}\n`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(`${msg}\n`);
}

function sendNotification(method, params) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  process.stdout.write(`${msg}\n`);
}

async function httpRequest(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(path, AMTS_BASE_URL);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  try {
    switch (method) {
      case "initialize": {
        sendResponse(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: "amts",
            version: "1.0.0",
          },
        });
        break;
      }

      case "notifications/initialized": {
        // Client acknowledged init — nothing to do
        break;
      }

      case "tools/list": {
        if (!toolsCache) {
          toolsCache = await httpRequest("/mcp/tools");
        }
        sendResponse(id, toolsCache);
        break;
      }

      case "tools/call": {
        const { name, arguments: args } = params;
        const result = await httpRequest("/mcp/tools/call", "POST", { name, arguments: { ...args, _cwd: SHIM_CWD } });
        if (result.error) {
          sendError(id, -32000, result.error.message);
        } else {
          sendResponse(id, result);
        }
        break;
      }

      case "resources/list": {
        if (!resourcesCache) {
          resourcesCache = await httpRequest("/mcp/resources");
        }
        sendResponse(id, resourcesCache);
        break;
      }

      case "resources/read": {
        const result = await httpRequest("/mcp/resources/read", "POST", { uri: params.uri });
        if (result.error) {
          sendError(id, -32002, result.error.message);
        } else {
          sendResponse(id, result);
        }
        break;
      }

      case "prompts/list": {
        if (!promptsCache) {
          promptsCache = await httpRequest("/mcp/prompts");
        }
        sendResponse(id, promptsCache);
        break;
      }

      case "prompts/get": {
        const result = await httpRequest("/mcp/prompts/get", "POST", {
          name: params.name,
          arguments: params.arguments,
        });
        if (result.error) {
          sendError(id, -32002, result.error.message);
        } else {
          sendResponse(id, result);
        }
        break;
      }

      case "ping": {
        sendResponse(id, {});
        break;
      }

      default: {
        if (id !== undefined) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
      }
    }
  } catch (err) {
    if (id !== undefined) {
      sendError(id, -32603, err.message || "Internal error");
    }
  }
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    handleMessage(msg);
  } catch (err) {
    process.stderr.write(`Failed to parse message: ${err.message}\n`);
  }
});

rl.on("close", () => process.exit(0));
