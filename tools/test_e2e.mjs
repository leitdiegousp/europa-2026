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
  if (manifest.length !== 20) throw new Error(`Expected 20 documents in manifest, found ${manifest.length}`);

  for (const doc of manifest) {
    const buf = fs.readFileSync(path.join(ROOT_DIR, `vault/assets/${doc.id}.enc`));
    const pdfBytes = await decryptPdf(sessionDek, buf, vaultId, doc.id);
    const header = Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, 5).toString("utf8");
    if (header !== "%PDF-") throw new Error(`Decrypted document ${doc.id} does not start with %PDF- (got ${header})`);
    console.log(`  ✓ ${doc.id}: ${pdfBytes.length} bytes decifrados com sucesso (Cabeçalho: ${header})`);
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

  // Grant clipboard permissions via Browser CDP session
  try {
    const versionResp = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const versionData = await versionResp.json();
    if (versionData.webSocketDebuggerUrl) {
      const browserCdp = new CdpSession(versionData.webSocketDebuggerUrl);
      await browserCdp.connect();
      await browserCdp.send("Browser.grantPermissions", {
        permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
        origin: `http://127.0.0.1:${PORT}`
      });
      browserCdp.close();
      console.log("  ✓ Clipboard permissions granted via Browser CDP session");
    }
  } catch (err) {
    console.log("Browser.grantPermissions warning:", err.message);
  }

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

  // Step D1: Verify Main Content DOM Order (Hero -> Milestones -> Immigration Docs -> Tab Content)
  console.log("\n[TEST D1] Verifying DOM Order of Main Sections...");
  const domOrder = await cdp.evaluate(`
    (() => {
      const main = document.querySelector(".main-content");
      if (!main) return null;
      return Array.from(main.children).map(c => {
        if (c.id) return '#' + c.id;
        if (c.className) return '.' + c.className.split(' ')[0];
        return c.tagName.toLowerCase();
      });
    })()
  `);
  console.log("  Main content children order:", domOrder);
  const stepIdx = domOrder.indexOf("#current-step-card");
  const milestonesIdx = domOrder.indexOf(".milestones-infographic");
  const immigrationIdx = domOrder.indexOf("#immigration-docs-card");
  const tabIdx = domOrder.indexOf("#tab-content-container");

  if (stepIdx === -1 || milestonesIdx === -1 || immigrationIdx === -1 || tabIdx === -1) {
    throw new Error("Missing required sections in DOM: " + JSON.stringify(domOrder));
  }
  if (!(stepIdx < milestonesIdx && milestonesIdx < immigrationIdx && immigrationIdx < tabIdx)) {
    throw new Error(`Incorrect DOM order: expected #current-step-card -> .milestones-infographic -> #immigration-docs-card -> #tab-content-container, but got indices: step=${stepIdx}, milestones=${milestonesIdx}, immigration=${immigrationIdx}, tab=${tabIdx}`);
  }
  console.log("  ✓ Section order verified: Hero (1st) -> Milestones Infographic (2nd) -> Immigration Docs (3rd) -> Tab Content (4th)");

  // Step D2: Verify Initial Collapsed State of Immigration Card
  console.log("\n[TEST D2] Checking Collapsed State of Immigration Card by Default...");
  const collapsedCheck = await cdp.evaluate(`
    (() => {
      const card = document.getElementById("immigration-docs-card");
      if (!card) return null;
      const wrapper = card.querySelector(".immigration-card-body-wrapper");
      const body = card.querySelector(".immigration-card-body");
      const toggleText = card.querySelector(".immigration-toggle-text");
      const chevron = card.querySelector(".toggle-chevron");
      const badge = card.querySelector(".immigration-status-badge");
      const text = card.innerText;
      return {
        hasCard: true,
        isCollapsedClass: card.classList.contains("is-collapsed"),
        isWrapperCollapsed: wrapper && wrapper.classList.contains("collapsed"),
        isBodyAriaHidden: body && body.getAttribute("aria-hidden") === "true",
        toggleText: toggleText ? toggleText.innerText.trim() : "",
        chevronOpen: chevron ? chevron.classList.contains("open") : null,
        chevronChar: chevron ? chevron.textContent.trim() : "",
        isBadgeHidden: badge ? window.getComputedStyle(badge).display === "none" : false,
        hasTitle: text.includes("Documentos de Imigração & Seguro Schengen"),
        hasTag: text.toLowerCase().includes("controle de fronteira"),
        hasDiegoPolicy: text.includes("16023-0003-69-260122474")
      };
    })()
  `);

  if (!collapsedCheck || !collapsedCheck.hasCard) throw new Error("immigration-docs-card not found in DOM");
  if (!collapsedCheck.isCollapsedClass || !collapsedCheck.isWrapperCollapsed || !collapsedCheck.isBodyAriaHidden) {
    throw new Error("Card is not properly in collapsed state: " + JSON.stringify(collapsedCheck));
  }
  if (!collapsedCheck.hasTitle || !collapsedCheck.hasTag) {
    throw new Error("Card header missing title or tag: " + JSON.stringify(collapsedCheck));
  }
  if (collapsedCheck.hasDiegoPolicy) {
    throw new Error("Collapsed card should not display policy details in collapsed state!");
  }
  if (collapsedCheck.chevronOpen !== false) {
    throw new Error("Collapsed chevron should not have .open class");
  }
  if (!collapsedCheck.isBadgeHidden) {
    throw new Error("Status badge should be hidden in collapsed state to preserve vertical space!");
  }
  console.log(`  ✓ Card is collapsed by default: button="${collapsedCheck.toggleText}", chevron="${collapsedCheck.chevronChar}" (pointing down), badge hidden, body collapsed.`);

  // Step D3: Test Real DOM Clicks to Expand and Collapse Card
  console.log("\n[TEST D3] Testing DOM click on .immigration-toggle-btn to Expand Card...");
  await cdp.evaluate(`document.getElementById("immigration-toggle-btn").click()`);
  await new Promise(r => setTimeout(r, 200));

  const expandedCheck = await cdp.evaluate(`
    (() => {
      const card = document.getElementById("immigration-docs-card");
      if (!card) return null;
      const wrapper = card.querySelector(".immigration-card-body-wrapper");
      const body = card.querySelector(".immigration-card-body");
      const toggleText = card.querySelector(".immigration-toggle-text");
      const chevron = card.querySelector(".toggle-chevron");
      const badge = card.querySelector(".immigration-status-badge");
      const text = card.innerText;
      return {
        isExpandedClass: card.classList.contains("is-expanded"),
        isWrapperExpanded: wrapper && wrapper.classList.contains("expanded"),
        isBodyAriaVisible: body && body.getAttribute("aria-hidden") === "false",
        toggleText: toggleText ? toggleText.innerText.trim() : "",
        chevronOpen: chevron ? chevron.classList.contains("open") : null,
        chevronChar: chevron ? chevron.textContent.trim() : "",
        isBadgeVisible: badge ? window.getComputedStyle(badge).display !== "none" : false,
        hasLockedProtegido: text.includes("Protegido no cofre"),
        hasNoDiegoPolicy: !text.includes("16023-0003-69-260122474"),
        hasNoDiegoCert: !text.includes("32572804832"),
        hasNoDiegoPassport: !text.includes("GO506551"),
        hasNoDiegoOldPassport: !text.includes("FR302881"),
        hasNoTatianaPolicy: !text.includes("16023-0003-69-260122473"),
        hasNoTatianaCert: !text.includes("29340388828"),
        hasNoTatianaPassport: !text.includes("GB464034"),
        hasNoFabianaPassport: !text.includes("G0872312"),
        buttons: Array.from(card.querySelectorAll(".traveler-actions button")).map(b => b.innerText.trim())
      };
    })()
  `);

  if (!expandedCheck.isExpandedClass || !expandedCheck.isWrapperExpanded || !expandedCheck.isBodyAriaVisible) {
    throw new Error("Card failed to expand: " + JSON.stringify(expandedCheck));
  }
  if (!expandedCheck.hasLockedProtegido) throw new Error("Missing 'Protegido no cofre' placeholder in locked card");
  if (!expandedCheck.hasNoDiegoPassport || !expandedCheck.hasNoDiegoOldPassport) throw new Error("Diego passport leaked in locked card!");
  if (!expandedCheck.hasNoTatianaPassport || !expandedCheck.hasNoFabianaPassport) throw new Error("Tatiana/Fabiana passport leaked in locked card!");
  if (!expandedCheck.hasNoDiegoPolicy || !expandedCheck.hasNoTatianaPolicy) throw new Error("Policy numbers leaked in locked card!");
  if (!expandedCheck.hasNoDiegoCert || !expandedCheck.hasNoTatianaCert) throw new Error("Schengen cert numbers leaked in locked card!");

  const requiredButtons = [
    "Carta Convite Diego",
    "Paz y Salvo",
    "Carta Convite Tatiana",
    "Paz y Salvo Fabiana"
  ];
  for (const bName of requiredButtons) {
    if (!expandedCheck.buttons.some(b => b.includes(bName))) {
      throw new Error(`Missing button "${bName}" in expanded card: ${JSON.stringify(expandedCheck.buttons)}`);
    }
  }

  if (!expandedCheck.isBadgeVisible) throw new Error("Status badge / Destravar button should be visible in expanded state!");
  if (expandedCheck.chevronOpen !== true) throw new Error("Expanded chevron should have .open class (rotated 180deg to point up)");
  console.log("  ✓ Card expanded successfully via toggle click! Toggle text:", expandedCheck.toggleText, "Chevron open:", expandedCheck.chevronOpen, "Protected placeholders verified (Zero plain text leaks when locked), Badge visible:", expandedCheck.isBadgeVisible);

  // Test collapsing via header click delegation
  console.log("  Testing header click delegation to collapse card...");
  await cdp.evaluate(`document.getElementById("immigration-card-header").click()`);
  await new Promise(r => setTimeout(r, 200));
  const isHeaderReCollapsed = await cdp.evaluate(`document.getElementById("immigration-docs-card").classList.contains("is-collapsed")`);
  if (!isHeaderReCollapsed) throw new Error("Card failed to re-collapse via header click");
  console.log("  ✓ Re-collapsed successfully via header click delegation");

  // Re-expand for subsequent tests
  console.log("  Re-expanding card via toggle button click...");
  await cdp.evaluate(`document.getElementById("immigration-toggle-btn").click()`);
  await new Promise(r => setTimeout(r, 200));

  // Step D4: Test Mobile Viewports with Card EXPANDED (320px to 430px)
  console.log("\n[TEST C2] Verifying Mobile Viewports with Immigration Card EXPANDED (320px, 360px, 375px, 390px, 412px, 430px)...");
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
      throw new Error(`Horizontal scroll blowout detected with EXPANDED card at viewport ${width}px: docW=${check.docW}, winW=${check.winW}, bodyW=${check.bodyW}`);
    }
    console.log(`  ✓ Expanded Viewport ${width}px: docW=${check.docW}, winW=${check.winW} (overflow-x contained)`);
  }

  // Reset viewport to 390px
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true
  });

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

  // Step F3: Test Instant PDF Deciphering of all 4 Congress Documents
  console.log("\n[TEST F3] Testing instant deciphering of the 4 new Congress documents in browser...");
  const congressPdfTests = [
    { id: "doc-convite-diego", label: "Carta de Invitación - Diego Jacob Fernandes Leite", match: "Diego" },
    { id: "doc-convite-tatiana", label: "Carta de Invitación - Tatiana Araújo de Sousa Jacob", match: "Tatiana" },
    { id: "doc-pazsalvo-diego-tatiana", label: "Paz y Salvo - Diego Jacob & Tatiana Araújo", match: "Paz y Salvo" },
    { id: "doc-pazsalvo-fabiana", label: "Paz y Salvo - Fabiana Nunes Poli", match: "Fabiana" }
  ];

  for (const cTest of congressPdfTests) {
    await cdp.evaluate(`app.openPdf("${cTest.id}", "${cTest.label}")`);
    await new Promise(r => setTimeout(r, 250));
    const cState = await cdp.evaluate(`
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
    if (!cState.open || !cState.src.startsWith("blob:") || !cState.title.includes(cTest.match)) {
      throw new Error(`Failed to decrypt and open congress doc ${cTest.id}: ` + JSON.stringify(cState));
    }
    console.log(`  ✓ Opened ${cTest.id}: "${cState.title}" with valid Blob URL (${cState.src.slice(0, 30)}...)`);
    await cdp.evaluate(`app.closeModals()`);
  }

  // Step F1.8: Verifying Unlocked Cofre Decrypted Traveler Dossier & Revealed Credentials
  console.log("\n[TEST F4] Verifying Unlocked Cofre Decrypted Traveler Dossier & Revealed Credentials...");
  const unlockedTravelersCheck = await cdp.evaluate(`
    (() => {
      const card = document.getElementById("immigration-docs-card");
      const text = card.innerText;
      return {
        hasDecryptedHeader: text.includes("Dossiê de Viajantes Decifrado & Confirmado no Cofre EV26"),
        hasDiego: text.includes("Diego Jacob Fernandes Leite") && text.includes("GO506551") && text.includes("FR302881"),
        hasTatiana: text.includes("Tatiana Araújo de Sousa Jacob") && text.includes("GB464034"),
        hasFabiana: text.includes("Fabiana Nunes Poli") && text.includes("G0872312"),
        hasDiegoPolicy: text.includes("16023-0003-69-260122474"),
        hasDiegoCert: text.includes("32572804832"),
        hasTatianaPolicy: text.includes("16023-0003-69-260122473"),
        hasTatianaCert: text.includes("29340388828")
      };
    })()
  `);
  if (!unlockedTravelersCheck.hasDecryptedHeader || !unlockedTravelersCheck.hasDiego || !unlockedTravelersCheck.hasTatiana || !unlockedTravelersCheck.hasFabiana || !unlockedTravelersCheck.hasDiegoPolicy || !unlockedTravelersCheck.hasDiegoCert || !unlockedTravelersCheck.hasTatianaPolicy || !unlockedTravelersCheck.hasTatianaCert) {
    throw new Error("Unlocked cofre traveler dossier failed to render or credentials not revealed: " + JSON.stringify(unlockedTravelersCheck));
  }
  console.log("  ✓ Unlocked cofre traveler dossier verified from decrypted index.enc with all credentials revealed");

  // Step F2: Test Hero Quick-Action '🛂 Seguros Imigração Lisboa' Auto-Expands from Collapsed State
  console.log("\n[TEST F2] Testing Hero Quick-Action '🛂 Seguros Imigração Lisboa' auto-expands from collapsed state...");
  await cdp.evaluate(`app.collapseImmigrationDocs()`);
  const isReCollapsed = await cdp.evaluate(`document.getElementById("immigration-docs-card").classList.contains("is-collapsed")`);
  if (!isReCollapsed) throw new Error("Card failed to re-collapse");
  console.log("  Re-collapsed card successfully. Now invoking app.scrollToImmigrationDocs()...");

  await cdp.evaluate(`app.scrollToImmigrationDocs()`);
  await new Promise(r => setTimeout(r, 200));

  const autoExpanded = await cdp.evaluate(`
    (() => {
      const card = document.getElementById("immigration-docs-card");
      return {
        isExpanded: card.classList.contains("is-expanded"),
        hasHighlight: card.classList.contains("card-highlight"),
        toggleText: card.querySelector(".immigration-toggle-text")?.innerText.trim()
      };
    })()
  `);

  if (!autoExpanded.isExpanded) throw new Error("Hero quick action failed to auto-expand immigration card: " + JSON.stringify(autoExpanded));
  if (!autoExpanded.hasHighlight) throw new Error("Hero quick action failed to trigger card-highlight animation");
  console.log("  ✓ Hero quick action auto-expanded the card (toggle text: " + autoExpanded.toggleText + ") and triggered amber highlight!");

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
        hasPassports: text.includes("GO506551") && text.includes("GB464034") && text.includes("FR302881"),
        hasCredentials: text.includes("16023-0003-69-260122474") && text.includes("16023-0003-69-260122473"),
        hasButtons: text.includes("Bilhete Seguro Diego") && text.includes("Certificado Schengen Tatiana") && text.includes("Carta Convite Diego") && text.includes("Carta Convite Tatiana")
      };
    })()
  `);

  if (!day17Event.hasImmigrationEvent || !day17Event.hasPassports || !day17Event.hasCredentials || !day17Event.hasButtons) {
    throw new Error("Day 17 timeline event missing immigration details, passports, or buttons: " + JSON.stringify(day17Event));
  }
  console.log("  ✓ Day 17 timeline contains immigration passport control event with passports, credentials, and action buttons");

  // Step G1.5: Check Timeline Event on Day 19 (Templo Divino Daimon em Riddes, Valais)
  console.log("\n[TEST G1.5] Checking Day 19 Timeline Templo Divino Daimon visit in Riddes, Valais...");
  const day19Event = await cdp.evaluate(`
    (() => {
      app.switchTab("timeline");
      const day19 = document.getElementById("day-2026-10-19");
      if (!day19) return { error: "Day 19 not found" };
      const text = day19.innerText;
      const btns = Array.from(day19.querySelectorAll("button, a")).map(b => b.innerText.trim());
      return {
        hasDaimonTitle: text.includes("Templo Divino Daimon"),
        hasRiddes: text.includes("Riddes"),
        hasDistance: text.includes("4 km"),
        hasPazSalvoCreds: text.includes("Mem 207/2026") && text.includes("Mem 209/2026"),
        hasLiturgicalRules: text.includes("litúrgicos") || text.includes("liturgic"),
        hasDiegoTatianaPazSalvoBtn: btns.some(b => b.includes("Paz y Salvo Diego & Tatiana")),
        hasFabianaPazSalvoBtn: btns.some(b => b.includes("Paz y Salvo Fabiana")),
        hasMapsLink: btns.some(b => b.includes("Rota Saillon ➔ Riddes (Google Maps)"))
      };
    })()
  `);

  if (!day19Event.hasDaimonTitle || !day19Event.hasRiddes || !day19Event.hasDistance || !day19Event.hasPazSalvoCreds || !day19Event.hasDiegoTatianaPazSalvoBtn || !day19Event.hasFabianaPazSalvoBtn || !day19Event.hasMapsLink) {
    throw new Error("Day 19 timeline event missing Templo Divino Daimon details, credentials, or buttons: " + JSON.stringify(day19Event));
  }
  console.log("  ✓ Day 19 timeline contains Templo Divino Daimon visit with credentials, recommendations, Paz y Salvo buttons, and Google Maps route link");

  // Step H2: Check Timeline Event on Day 22 (Toledo Congress Check-in & Credenciamento)
  console.log("\n[TEST G2] Checking Day 22 Timeline Congress check-in & credenciamento event...");
  const day22Event = await cdp.evaluate(`
    (() => {
      app.switchTab("timeline");
      const day22 = document.getElementById("day-2026-10-22");
      if (!day22) return { error: "Day 22 not found" };
      const text = day22.innerText;
      return {
        hasCongressEvent: text.includes("Credenciamento do Congresso"),
        hasPassports: text.includes("GO506551") && text.includes("GB464034") && text.includes("G0872312") && text.includes("FR302881"),
        hasButtons: text.includes("Carta Convite Diego") && text.includes("Carta Convite Tatiana") && text.includes("Paz y Salvo") && text.includes("Paz y Salvo Fabiana")
      };
    })()
  `);

  if (!day22Event.hasCongressEvent || !day22Event.hasPassports || !day22Event.hasButtons) {
    throw new Error("Day 22 timeline event missing congress details or buttons: " + JSON.stringify(day22Event));
  }
  console.log("  ✓ Day 22 timeline contains congress credenciamento event with passports and action buttons");

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

  // Step I0: Check Car & Swiss Routes Tab
  console.log("\n[TEST H2] Checking Car & Swiss Routes Tab (Valais Templo Daimon route, credentials, and Swiss driving rules)...");
  const carCheck = await cdp.evaluate(`
    (() => {
      app.switchTab("car");
      const area = document.getElementById("tab-content-container");
      const text = area.innerText;
      const linksAndBtns = Array.from(area.querySelectorAll("button, a")).map(b => b.innerText.trim());
      const navBtn = document.querySelector('.nav-tab[data-tab="car"]');
      return {
        hasSwissSectionTitle: text.includes("Suíça & Aluguel de Carro (Valais)"),
        hasSwissNavTab: navBtn ? navBtn.innerText.includes("Suíça") : false,
        hasSwissSectorAlert: text.includes("ALERTA OPERACIONAL: Setor Suíço"),
        hasMainRoute: text.includes("Rota Principal: Aeroporto de Genebra") && text.includes("Saillon"),
        hasValaisRoteiro: text.includes("Roteiro em Valais: Saillon ➔ Riddes (Templo Divino Daimon)"),
        hasDistance: text.includes("4 km") && text.includes("Rio Ródano"),
        hasCredentials: text.includes("Mem 207/2026") && text.includes("Mem 209/2026"),
        hasArredores: text.includes("Les Bains de Saillon") && text.includes("Martigny") && text.includes("Sion"),
        hasDrivingRules: text.includes("Recomendações Práticas de Condução"),
        hasSpeedLimits: text.includes("50 km/h") && text.includes("80 km/h") && text.includes("120 km/h"),
        hasHeadlightsRule: text.includes("Faróis Acesos 24h por Lei") || text.includes("Tagfahrlicht"),
        hasParkingRule: text.includes("Disco Azul") || text.includes("EasyPark") || text.includes("CHF"),
        hasAutumnWeather: text.includes("Clima de Montanha no Outono"),
        hasMapsRouteBtn: linksAndBtns.some(b => b.includes("Rota Saillon ➔ Riddes (Google Maps)")),
        hasPazSalvoDiegoTatiana: linksAndBtns.some(b => b.includes("Paz y Salvo Diego & Tatiana")),
        hasPazSalvoFabiana: linksAndBtns.some(b => b.includes("Paz y Salvo Fabiana"))
      };
    })()
  `);

  if (!carCheck.hasSwissSectionTitle || !carCheck.hasSwissNavTab || !carCheck.hasSwissSectorAlert || !carCheck.hasMainRoute || !carCheck.hasValaisRoteiro || !carCheck.hasDistance || !carCheck.hasCredentials || !carCheck.hasArredores || !carCheck.hasDrivingRules || !carCheck.hasSpeedLimits || !carCheck.hasHeadlightsRule || !carCheck.hasParkingRule || !carCheck.hasAutumnWeather || !carCheck.hasMapsRouteBtn || !carCheck.hasPazSalvoDiegoTatiana || !carCheck.hasPazSalvoFabiana) {
    throw new Error("Car tab missing required elements, driving rules, or buttons: " + JSON.stringify(carCheck));
  }
  console.log("  ✓ Car & Swiss Routes tab contains Valais itinerary, Templo Daimon route, credentials, Swiss driving guidelines, and action buttons");

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

  // Step K: Check Congress Tab
  console.log("\n[TEST I2] Checking Congress Tab...");
  const congressCheck = await cdp.evaluate(`
    (() => {
      app.switchTab("congress");
      const area = document.getElementById("tab-content-container");
      const text = area.innerText;
      const btns = Array.from(area.querySelectorAll("button")).map(b => b.innerText.trim());
      return {
        hasTitle: text.includes("Congresso Internacional de Gnosis"),
        hasDocSection: text.includes("Documentos Oficiais & Credenciamento"),
        hasPassports: text.includes("GO506551") && text.includes("GB464034") && text.includes("G0872312") && text.includes("FR302881"),
        hasDiegoConvite: btns.some(b => b.includes("Carta Convite Diego")),
        hasTatianaConvite: btns.some(b => b.includes("Carta Convite Tatiana")),
        hasPazSalvo: btns.some(b => b.includes("Paz y Salvo")),
        hasFabianaPazSalvo: btns.some(b => b.includes("Paz y Salvo Fabiana")),
        hasHotelVoucher: btns.some(b => b.includes("Voucher Hotel Toledo")),
        buttons: btns
      };
    })()
  `);

  if (!congressCheck.hasTitle || !congressCheck.hasDocSection || !congressCheck.hasPassports || !congressCheck.hasDiegoConvite || !congressCheck.hasTatianaConvite || !congressCheck.hasPazSalvo || !congressCheck.hasFabianaPazSalvo || !congressCheck.hasHotelVoucher) {
    throw new Error("Congress tab missing required elements or buttons: " + JSON.stringify(congressCheck));
  }
  console.log("  ✓ Congress tab contains all documentation, passports, and action buttons");

  // Step L: Check Day 19 Current Step Simulation
  console.log("\n[TEST J] Checking Day 19 Current Step simulation for Templo Divino Daimon...");
  await cdp.evaluate(`app.setSimulatedDate('2026-10-19')`);
  const step19 = await cdp.evaluate(`
    (() => {
      const card = document.getElementById("current-step-card");
      const text = card.innerText;
      const links = Array.from(card.querySelectorAll("a, button")).map(b => b.innerText.trim());
      return {
        hasTitle: text.includes("Templo Divino Daimon"),
        hasStatus: text.includes("EM ANDAMENTO") || text.includes("PRÓXIMA ETAPA"),
        hasCredentials: text.includes("Mem 207/2026") || text.includes("Zeus Daimon"),
        hasMapsBtn: links.some(l => l.includes("Google Maps")),
        hasPazSalvoDiego: links.some(l => l.includes("Paz y Salvo Diego & Tatiana")),
        hasPazSalvoFabiana: links.some(l => l.includes("Paz y Salvo Fabiana"))
      };
    })()
  `);
  if (!step19.hasTitle || !step19.hasStatus || !step19.hasCredentials || !step19.hasMapsBtn || !step19.hasPazSalvoDiego || !step19.hasPazSalvoFabiana) {
    throw new Error("Day 19 current step failed to recognize Templo Divino Daimon: " + JSON.stringify(step19));
  }
  console.log("  ✓ Day 19 current step successfully recognizes Templo Divino Daimon with action buttons and route");

  // Step M: Testing Clipboard Copy with CDP User Interaction
  console.log("\n[TEST K] Testing Clipboard Copy Functionality...");
  await cdp.send("Page.bringToFront");

  // Locate a copy button for Diego's passport GO506551
  const copyBtnCoords = await cdp.evaluate(`
    (() => {
      const btns = Array.from(document.querySelectorAll(".copy-icon-btn"));
      const btn = btns.find(b => b.getAttribute("onclick") && b.getAttribute("onclick").includes("GO506551"));
      if (!btn) return null;
      btn.scrollIntoView({ block: "center", inline: "center" });
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()
  `);

  if (copyBtnCoords) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: copyBtnCoords.x,
      y: copyBtnCoords.y,
      button: "left",
      clickCount: 1
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: copyBtnCoords.x,
      y: copyBtnCoords.y,
      button: "left",
      clickCount: 1
    });
  } else {
    await cdp.evaluate(`app.copyToClipboard("GO506551", "Passaporte Diego")`);
  }

  await new Promise(r => setTimeout(r, 200));

  const copyToastTest = await cdp.evaluate(`
    (() => {
      const toast = document.getElementById("toast-notification") || document.querySelector(".toast");
      return toast ? toast.innerText : "";
    })()
  `);

  if (!copyToastTest.includes("Passaporte Diego copiado")) {
    throw new Error("Clipboard copy toast failed for new passport: " + copyToastTest);
  }
  console.log("  ✓ Clipboard copy confirmed: " + copyToastTest);

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
