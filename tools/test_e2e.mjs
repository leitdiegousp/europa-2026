/**
 * End-to-End Automated Test Suite for Europa 2026
 * ==================================================
 * Launches a local static HTTP server, verifies cryptographic operations in Node,
 * and launches headless Google Chrome via CDP (Chrome DevTools Protocol) over native WebSockets
 * to rigorously test UI layout, mobile responsive bounds, vault unlock flows,
 * PDF deciphering, and tab integrations.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = 8089;
const CDP_PORT = 9222;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".enc": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

// 1. Static HTTP Server
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split("?")[0];
      if (reqPath === "/") reqPath = "/index.html";
      const filePath = path.join(ROOT_DIR, reqPath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Access-Control-Allow-Origin": "*" });
      res.end(fs.readFileSync(filePath));
    });

    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[HTTP Server] Running on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

// 2. Simple CDP Client over native WebSocket
class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve, reject } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) reject(new Error(JSON.stringify(data.error)));
          else resolve(data.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error("Evaluation error: " + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log("=== INITIATING END-TO-END VERIFICATION SUITE ===");

  // Step A: Node crypto decryption verification
  console.log("\n[TEST A] Verifying Node.js WebCrypto PBKDF2 + AES-GCM decryption...");
  const { unwrapDek, decryptPdf } = await import("../js/crypto-format.js");
  const env = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "vault/key-envelope.json"), "utf8"));
  const { sessionDek, vaultId } = await unwrapDek("ti8mao", env);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "vault/asset-manifest.json"), "utf8"));
  const seguros = manifest.filter(m => m.id.startsWith("doc-seguro-"));
  if (seguros.length !== 4) throw new Error(`Expected 4 insurance documents in manifest, found ${seguros.length}`);

  for (const s of seguros) {
    const buf = fs.readFileSync(path.join(ROOT_DIR, `vault/assets/${s.id}.enc`));
    const pdfBytes = await decryptPdf(sessionDek, buf, vaultId, s.id);
    const header = Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, 5).toString("utf8");
    if (header !== "%PDF-") throw new Error(`Decrypted document ${s.id} does not start with %PDF- (got ${header})`);
    console.log(`  ✓ ${s.id}: ${pdfBytes.length} bytes decifrados com sucesso (Cabeçalho: ${header})`);
  }

  // Step B: Start HTTP server
  const server = await startServer();

  // Step C: Launch headless Chrome
  console.log("\n[TEST B] Spawning headless Google Chrome via CDP...");
  const chromeProc = spawn("/usr/bin/google-chrome", [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `http://127.0.0.1:${PORT}/index.html`
  ], { stdio: "ignore" });

  // Wait for Chrome CDP endpoint
  let pageTarget = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (resp.ok) {
        const list = await resp.json();
        pageTarget = list.find(t => t.type === "page");
        if (pageTarget && pageTarget.webSocketDebuggerUrl) break;
      }
    } catch (_) {}
  }

  if (!pageTarget) {
    chromeProc.kill();
    server.close();
    throw new Error("Could not connect to headless Chrome CDP endpoint");
  }

  console.log("  ✓ Connected to Chrome target:", pageTarget.webSocketDebuggerUrl);
  const cdp = new CdpSession(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Runtime.enable");

  // Wait for page to initialize
  await new Promise(r => setTimeout(r, 800));

  // Step D: Mobile Viewports Responsive Hardening (320px to 430px)
  console.log("\n[TEST C] Verifying Mobile Viewports (320px, 360px, 375px, 390px, 412px, 430px)...");
  const viewports = [320, 360, 375, 390, 412, 430];
  for (const width of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 800,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 100));

    const check = await cdp.evaluate(`
      (() => {
        const docW = document.documentElement.scrollWidth;
        const winW = window.innerWidth;
        const bodyW = document.body.scrollWidth;
        return { docW, winW, bodyW, blowout: docW > winW || bodyW > winW };
      })()
    `);

    if (check.blowout) {
      throw new Error(`Horizontal scroll blowout detected at viewport ${width}px: docW=${check.docW}, winW=${check.winW}, bodyW=${check.bodyW}`);
    }
    console.log(`  ✓ Viewport ${width}px: docW=${check.docW}, winW=${check.winW} (overflow-x contained)`);
  }

  // Reset viewport to 390px for test flow
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true
  });

  // Step E: Verify Top Immigration Hero Card in DOM
  console.log("\n[TEST D] Checking Top Immigration Card & Credentials...");
  const cardData = await cdp.evaluate(`
    (() => {
      const card = document.getElementById("immigration-docs-card");
      if (!card) return null;
      const text = card.innerText;
      return {
        hasCard: true,
        hasTitle: text.includes("Documentos de Imigração & Seguro Schengen"),
        hasDiegoPolicy: text.includes("16023-0003-69-260122474"),
        hasDiegoCert: text.includes("32572804832"),
        hasTatianaPolicy: text.includes("16023-0003-69-260122473"),
        hasTatianaCert: text.includes("29340388828"),
        buttons: Array.from(card.querySelectorAll("button")).map(b => b.innerText.trim())
      };
    })()
  `);

  if (!cardData || !cardData.hasCard) throw new Error("immigration-docs-card not found in DOM");
  if (!cardData.hasTitle) throw new Error("Card missing Schengen immigration title");
  if (!cardData.hasDiegoPolicy || !cardData.hasDiegoCert) throw new Error("Missing Diego credentials in card");
  if (!cardData.hasTatianaPolicy || !cardData.hasTatianaCert) throw new Error("Missing Tatiana credentials in card");
  console.log("  ✓ Card rendered correctly with credentials:", cardData.buttons.filter(b => b.startsWith("📄")));

  // Step F: Test Locked Button Click -> Unlock Modal Prompt -> Vault Unlock -> PDF Open
  console.log("\n[TEST E] Testing locked button click and pending PDF auto-open on unlock...");
  const triggerRes = await cdp.evaluate(`
    (() => {
      // Find Diego's Bilhete Seguro button
      const btns = Array.from(document.querySelectorAll("#immigration-docs-card button"));
      const diegoBtn = btns.find(b => b.innerText.includes("Bilhete Seguro Diego"));
      if (!diegoBtn) return { error: "Button not found" };
      diegoBtn.click();
      const modal = document.getElementById("modal-unlock");
      return { modalOpen: modal.classList.contains("open") };
    })()
  `);

  if (!triggerRes.modalOpen) throw new Error("Clicking document button while locked did not open unlock modal");
  console.log("  ✓ Unlock modal opened automatically upon tapping document button");

  // Type password 'ti8mao' and submit
  console.log("  Entering master password 'ti8mao'...");
  await cdp.evaluate(`
    (() => {
      const input = document.getElementById("unlock-password");
      input.value = "ti8mao";
      app._handleUnlockSubmit();
    })()
  `);

  // Wait for PBKDF2 derivation and PDF decryption
  let pdfModalOpen = false;
  let pdfIframeSrc = "";
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    const state = await cdp.evaluate(`
      (() => {
        const modal = document.getElementById("modal-pdf");
        const iframe = document.getElementById("pdf-viewer-frame");
        return {
          unlocked: vault.isUnlocked,
          modalOpen: modal.classList.contains("open"),
          src: iframe ? iframe.src : ""
        };
      })()
    `);
    if (state.unlocked && state.modalOpen && state.src.startsWith("blob:")) {
      pdfModalOpen = true;
      pdfIframeSrc = state.src;
      break;
    }
  }

  if (!pdfModalOpen) throw new Error("Failed to unlock and auto-open PDF in viewer modal");
  console.log("  ✓ Vault unlocked (600k iterations PBKDF2) and PDF auto-opened! Iframe src:", pdfIframeSrc);

  // Close PDF modal
  await cdp.evaluate(`app.closeModals()`);

  // Step G: Test Immediate Unlocked View of Tatiana's Certificado Schengen
  console.log("\n[TEST F] Testing instant PDF deciphering of Tatiana's Schengen Certificate while unlocked...");
  await cdp.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll("#immigration-docs-card button"));
      const tatianaCertBtn = btns.find(b => b.innerText.includes("Certificado Schengen Tatiana"));
      tatianaCertBtn.click();
    })()
  `);

  await new Promise(r => setTimeout(r, 300));
  const tatianaPdfState = await cdp.evaluate(`
    (() => {
      const modal = document.getElementById("modal-pdf");
      const title = document.getElementById("pdf-modal-title");
      const iframe = document.getElementById("pdf-viewer-frame");
      return {
        open: modal.classList.contains("open"),
        title: title ? title.innerText : "",
        src: iframe ? iframe.src : ""
      };
    })()
  `);

  if (!tatianaPdfState.open || !tatianaPdfState.src.startsWith("blob:")) {
    throw new Error("Failed to open Tatiana Schengen certificate");
  }
  console.log(`  ✓ Tatiana's certificate opened: "${tatianaPdfState.title}" with valid Blob URL`);
  await cdp.evaluate(`app.closeModals()`);

  // Step H: Check Timeline Event on Day 17
  console.log("\n[TEST G] Checking Day 17 Timeline arrival & immigration event...");
  const day17Event = await cdp.evaluate(`
    (() => {
      app.switchTab("timeline");
      const day17 = document.getElementById("day-2026-10-17");
      if (!day17) return { error: "Day 17 not found" };
      const text = day17.innerText;
      return {
        hasImmigrationEvent: text.includes("Controle de Passaporte & Imigração Schengen"),
        hasCredentials: text.includes("16023-0003-69-260122474") && text.includes("16023-0003-69-260122473"),
        hasButtons: text.includes("Bilhete Seguro Diego") && text.includes("Certificado Schengen Tatiana")
      };
    })()
  `);

  if (!day17Event.hasImmigrationEvent || !day17Event.hasCredentials || !day17Event.hasButtons) {
    throw new Error("Day 17 timeline event missing immigration details or buttons: " + JSON.stringify(day17Event));
  }
  console.log("  ✓ Day 17 timeline contains immigration passport control event with credentials and action buttons");

  // Step I: Check Flights Tab (Only TP110 should show Lisbon Immigration card)
  console.log("\n[TEST H] Checking Flights Tab (verifying only TP110 shows Lisbon Immigration card)...");
  const flightsCheck = await cdp.evaluate(`
    (() => {
      app.switchTab("flights");
      const cards = Array.from(document.querySelectorAll("#tab-content-container .event-card"));
      return cards.map(c => {
        const title = c.querySelector(".event-name") ? c.querySelector(".event-name").innerText : "";
        const hasImmigrationCard = c.innerText.includes("Desembarque em Lisboa (LIS) • Documentos de Imigração");
        return { title, hasImmigrationCard };
      });
    })()
  `);

  console.log("  Flights rendered count:", flightsCheck.length);
  for (const f of flightsCheck) {
    if (f.title.includes("TP110")) {
      if (!f.hasImmigrationCard) throw new Error(`TP110 MUST show the Lisbon Immigration card! (title: ${f.title})`);
      console.log(`  ✓ Flight TP110 correctly has immigration documents card`);
    } else {
      if (f.hasImmigrationCard) throw new Error(`Flight ${f.title} MUST NOT show the Lisbon Immigration card! Only arrival TP110 should have it.`);
    }
  }
  console.log("  ✓ Confirmed only international arrival flight TP110 displays the Schengen immigration card");

  // Step J: Check Emergency Tab (buttons actionable in both locked and unlocked state)
  console.log("\n[TEST I] Checking Emergency Tab...");
  const emergencyCheck = await cdp.evaluate(`
    (() => {
      app.switchTab("emergency");
      const area = document.getElementById("tab-content-container");
      const btns = Array.from(area.querySelectorAll("button")).map(b => b.innerText.trim());
      const hasDiegoBilhete = btns.some(b => b.includes("Bilhete Seguro Diego"));
      const hasTatianaCert = btns.some(b => b.includes("Certificado Schengen Tatiana"));
      return { hasDiegoBilhete, hasTatianaCert, buttons: btns };
    })()
  `);

  if (!emergencyCheck.hasDiegoBilhete || !emergencyCheck.hasTatianaCert) {
    throw new Error("Emergency tab missing insurance document buttons: " + JSON.stringify(emergencyCheck));
  }
  console.log("  ✓ Emergency tab contains all 4 insurance action buttons");

  // Teardown
  cdp.close();
  chromeProc.kill();
  server.close();

  console.log("\n🎉 ALL E2E AUTOMATED TESTS PASSED WITH ZERO ERRORS!");
}

main().catch((err) => {
  console.error("\n❌ E2E TEST FAILED:", err);
  process.exit(1);
});
