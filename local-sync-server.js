#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

const defaults = {
  host: "127.0.0.1",
  port: 12525,
  server: "home",
  sourceRoot: process.cwd(),
  subfolder: "",
  download: [],
  newFile: [],
  extension: [".js", ".ns", ".txt", ".script"],
  omitFolder: ["Temp/"],
  devtoolsHost: "127.0.0.1",
  devtoolsPort: 0,
  terminalCommand: [],
};

function printUsage() {
  console.log(`Usage: node local-sync-server.js [options]

Starts a local WebSocket server for Bitburner's Remote API.
Then in Bitburner open: Options -> Remote API
Set hostname/port to match this script and press Connect.

Options:
  --host <host>              Local bind host (default: ${defaults.host})
  --port <port>              Local bind port (default: ${defaults.port})
  --server <server>          Bitburner server to upload to (default: ${defaults.server})
  --source-root <path>       Local source directory (default: current working directory)
  --subfolder <path>         Upload files into a Bitburner subfolder
  --download <file>          Upload only these files (repeatable)
  --new-file <file>          Add extra files to the upload list (repeatable)
  --extension <ext>          Allowed file extension when scanning local files (repeatable)
  --omit-folder <path>       Omit local folders when scanning files (repeatable)
  --devtools-host <host>     Chrome DevTools Protocol host for script-free game control
  --devtools-port <port>     Chrome DevTools Protocol port for script-free game control
  --terminal-command <cmd>   Terminal command to run through DevTools after upload (repeatable)
  --help                     Show this message

Example:
  node local-sync-server.js --source-root /Volumes/SRC/bitburner-scripts
  node local-sync-server.js --devtools-port 9222 --terminal-command "run autopilot.js"
`);
}

function trimSlash(value) {
  if (!value) return "";
  let result = value.replaceAll("\\", "/");
  while (result.startsWith("/")) result = result.slice(1);
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}

function pathJoin(...parts) {
  return trimSlash(parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/"));
}

function normalizeRelative(relativePath) {
  return trimSlash(relativePath);
}

function parseArgs(argv) {
  const options = structuredClone(defaults);
  const repeatedKeys = new Set(["download", "newFile", "extension", "omitFolder", "terminalCommand"]);
  const keyMap = new Map([
    ["host", "host"],
    ["port", "port"],
    ["server", "server"],
    ["source-root", "sourceRoot"],
    ["subfolder", "subfolder"],
    ["download", "download"],
    ["new-file", "newFile"],
    ["extension", "extension"],
    ["omit-folder", "omitFolder"],
    ["devtools-host", "devtoolsHost"],
    ["devtools-port", "devtoolsPort"],
    ["terminal-command", "terminalCommand"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const optionName = arg.slice(2);
    const mappedKey = keyMap.get(optionName);
    if (!mappedKey) {
      throw new Error(`Unknown option: ${arg}`);
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith("--")) {
      throw new Error(`Missing value for option: ${arg}`);
    }
    index += 1;
    if (repeatedKeys.has(mappedKey)) {
      options[mappedKey].push(value);
    } else {
      options[mappedKey] = mappedKey === "port" || mappedKey === "devtoolsPort" ? Number(value) : value;
    }
  }

  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error(`Invalid --port value: ${options.port}`);
  }
  if (!Number.isInteger(options.devtoolsPort) || options.devtoolsPort < 0 || options.devtoolsPort > 65535) {
    throw new Error(`Invalid --devtools-port value: ${options.devtoolsPort}`);
  }
  if (options.terminalCommand.length > 0 && !options.devtoolsPort) {
    throw new Error(`--terminal-command requires --devtools-port`);
  }
  options.subfolder = trimSlash(options.subfolder);
  options.sourceRoot = path.resolve(options.sourceRoot);
  options.omitFolder = options.omitFolder.map((folder) => trimSlash(folder)).filter(Boolean);
  return options;
}

async function listLocalFiles(rootDir, options) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    const relativePath = normalizeRelative(path.relative(options.sourceRoot, fullPath));
    if (entry.isDirectory()) {
      if (options.omitFolder.some((folder) => relativePath.startsWith(folder))) continue;
      files = files.concat(await listLocalFiles(fullPath, options));
      continue;
    }
    if (!options.extension.some((ext) => entry.name.endsWith(ext))) continue;
    files.push(relativePath);
  }
  return files;
}

function rewriteFileForSubfolder(relativePath, content, subfolder) {
  if (!subfolder || relativePath.includes("git-pull.js") || relativePath.includes("local-pull.js")) {
    return content;
  }
  let rewritten = content.replace(`const subfolder = ''`, `const subfolder = '${subfolder}/'`);
  rewritten = rewritten.replace(/from '(\.\/)?((?!\.\.\/).*)'/g, `from '${pathJoin(subfolder, "$2")}'`);
  return rewritten;
}

function createWebSocketAccept(key) {
  return crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`, "utf8")
    .digest("base64");
}

function encodeFrame(payload) {
  const body = Buffer.from(payload, "utf8");
  const length = body.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), body]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, body]);
}

function createFrameParser(onText, onClose) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 2) {
      const first = buffered[0];
      const second = buffered[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (buffered.length < offset + 2) return;
        payloadLength = buffered.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (buffered.length < offset + 8) return;
        const bigLength = buffered.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error("WebSocket frame too large");
        }
        payloadLength = Number(bigLength);
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      const frameLength = offset + maskLength + payloadLength;
      if (buffered.length < frameLength) return;

      let payload = buffered.subarray(offset + maskLength, frameLength);
      if (masked) {
        const mask = buffered.subarray(offset, offset + 4);
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
          unmasked[index] = payload[index] ^ mask[index % 4];
        }
        payload = unmasked;
      }

      buffered = buffered.subarray(frameLength);

      if (opcode === 0x8) {
        onClose();
        return;
      }
      if (opcode === 0x1) {
        onText(payload.toString("utf8"));
      }
    }
  };
}

async function getFilesToUpload(options) {
  const discoveredFiles =
    options.download.length > 0 ? options.download.map(normalizeRelative) : await listLocalFiles(options.sourceRoot, options);
  return [...new Set(discoveredFiles.concat(options.newFile.map(normalizeRelative)))];
}

async function pushFiles(socket, filesToUpload, options) {
  let nextId = 1;
  const pending = new Map();
  let closed = false;

  const parser = createFrameParser(
    (text) => {
      let message;
      try {
        message = JSON.parse(text);
      } catch (error) {
        console.error(`Invalid JSON from Bitburner: ${String(error)}`);
        return;
      }
      const waitForResponse = pending.get(message.id);
      if (!waitForResponse) return;
      pending.delete(message.id);
      if (message.error) {
        waitForResponse.reject(new Error(String(message.error)));
        return;
      }
      waitForResponse.resolve(message.result);
    },
    () => {
      closed = true;
      for (const waitForResponse of pending.values()) {
        waitForResponse.reject(new Error("Bitburner closed the Remote API connection"));
      }
      pending.clear();
    },
  );

  socket.on("data", parser);
  socket.on("close", () => parser(Buffer.alloc(0)));
  socket.on("end", () => parser(Buffer.from([0x88, 0x00])));
  socket.on("error", (error) => {
    if (closed) return;
    closed = true;
    for (const waitForResponse of pending.values()) {
      waitForResponse.reject(error);
    }
    pending.clear();
  });

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("Remote API connection is already closed"));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      socket.write(encodeFrame(payload));
    });
  }

  for (const relativePath of filesToUpload) {
    const localPath = path.join(options.sourceRoot, relativePath);
    const remotePath = pathJoin(options.subfolder, relativePath);
    const originalContent = await fs.readFile(localPath, "utf8");
    const rewrittenContent = rewriteFileForSubfolder(relativePath, originalContent, options.subfolder);
    process.stdout.write(`Uploading ${remotePath} ... `);
    await rpc("pushFile", {
      server: options.server,
      filename: remotePath,
      content: rewrittenContent,
    });
    process.stdout.write("OK\n");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return await response.json();
}

async function getBitburnerDevtoolsTarget(options) {
  const baseUrl = `http://${options.devtoolsHost}:${options.devtoolsPort}`;
  const targets = await fetchJson(`${baseUrl}/json/list`);
  const pageTargets = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  return pageTargets.find((target) => /bitburner/i.test(`${target.title || ""} ${target.url || ""}`)) ??
    pageTargets.find((target) => !/devtools/i.test(`${target.title || ""} ${target.url || ""}`)) ??
    pageTargets[0] ??
    null;
}

function cdpEvaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for DevTools Runtime.evaluate"));
    }, 10000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        reject(new Error(message.error.message || JSON.stringify(message.error)));
        return;
      }
      const exception = message.result?.exceptionDetails;
      if (exception) {
        reject(new Error(exception.exception?.description || exception.text || "Runtime.evaluate failed"));
        return;
      }
      resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to connect to DevTools target ${webSocketUrl}`));
    });
  });
}

function createTerminalCommandExpression(command) {
  const source = String.raw`
    async (command) => {
      let req = globalThis.__bbWebpackRequire;
      if (!req && globalThis.webpackChunkbitburner) {
        globalThis.webpackChunkbitburner.push([[Symbol("local-sync-terminal-command")], {}, (r) => { req = r; }]);
        globalThis.__bbWebpackRequire = req;
      }
      if (!req?.m) throw new Error("Bitburner webpack runtime was not found");
      let Terminal = null;
      for (const moduleId of Object.keys(req.m)) {
        try {
          const moduleExports = req(moduleId);
          if (moduleExports?.Terminal?.executeCommands) {
            Terminal = moduleExports.Terminal;
            break;
          }
        } catch { }
      }
      if (!Terminal) throw new Error("Bitburner Terminal module was not found");
      Terminal.executeCommands(command);
      return "Executed terminal command: " + command;
    }
  `;
  return `(${source})(${JSON.stringify(command)})`;
}

async function runTerminalCommandsThroughDevtools(options) {
  if (options.terminalCommand.length === 0) return;
  const target = await getBitburnerDevtoolsTarget(options);
  if (!target) {
    throw new Error(`No Bitburner DevTools page target found on ${options.devtoolsHost}:${options.devtoolsPort}`);
  }
  console.log(`Using DevTools target: ${target.title || target.url}`);
  for (const command of options.terminalCommand) {
    process.stdout.write(`Running terminal command through DevTools: ${command} ... `);
    await cdpEvaluate(target.webSocketDebuggerUrl, createTerminalCommandExpression(command));
    process.stdout.write("OK\n");
  }
}

function startServer(options) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.writeHead(426, { "Content-Type": "text/plain" });
      response.end("Bitburner Remote API expects a WebSocket upgrade.\n");
    });
    let activeConnection = false;

    server.on("upgrade", async (request, socket) => {
      if (activeConnection) {
        socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const upgrade = request.headers.upgrade;
      const key = request.headers["sec-websocket-key"];
      if (upgrade?.toLowerCase() !== "websocket" || typeof key !== "string") {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      activeConnection = true;

      const accept = createWebSocketAccept(key);
      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "",
          "",
        ].join("\r\n"),
      );

      try {
        const filesToUpload = await getFilesToUpload(options);
        console.log(`Bitburner connected. Uploading ${filesToUpload.length} file(s) to ${options.server}...`);
        await pushFiles(socket, filesToUpload, options);
        console.log(`Upload complete. ${filesToUpload.length} file(s) pushed to ${options.server}.`);
        await runTerminalCommandsThroughDevtools(options);
        socket.end();
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        socket.destroy();
      } finally {
        activeConnection = false;
        console.log(`Waiting for Bitburner to connect...`);
      }
    });

    server.on("error", reject);
    server.listen(options.port, options.host, () => {
      console.log(`Remote API server listening on ws://${options.host}:${options.port}`);
      console.log(`Waiting for Bitburner to connect...`);
      console.log(`In Bitburner: Options -> Remote API -> hostname "${options.host}" -> port "${options.port}" -> Connect`);
      resolve();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await startServer(options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
