/**
 * Europa 2026 - Main Application Controller
 * ==========================================
 * Orquestra o dashboard PWA, abas táticas, cofre criptográfico,
 * visualizador de PDFs e persistência offline.
 */

import { vault } from "./vault-client.js";
import { computeCurrentStep, formatTimeInZone, formatDateInZone, getCountdown } from "./time.js";

class EuropaApp {
  constructor() {
    this.publicTimeline = null;
    this.currentTab = "timeline";
    this.simulatedDate = null;
    this.activePdfRevoke = null;
    this.pendingPdfRequest = null;
    this.isImmigrationExpanded = false;

    this.init();
  }

  async init() {
    this._bindElements();
    this._bindEvents();
    this._registerServiceWorker();
    await this._loadPublicData();
    this.render();
  }

  _bindElements() {
    this.elHeaderStatus = document.getElementById("header-vault-status");
    this.elOfflinePill = document.getElementById("offline-status-pill");
    this.elCurrentStepCard = document.getElementById("current-step-card");
    this.elImmigrationDocsCard = document.getElementById("immigration-docs-card");
    this.elMilestonesTrackWrapper = document.querySelector(".milestones-track-wrapper");
    this.elMilestonesTrack = document.getElementById("milestones-track");
    this.elBtnLiveTime = document.getElementById("btn-live-time");
    this.elMainContainer = document.getElementById("tab-content-container");
    this.elToast = document.getElementById("toast-notification");

    // Modais
    this.elUnlockModal = document.getElementById("modal-unlock");
    this.elPdfModal = document.getElementById("modal-pdf");
    this.elUnlockPasswordInput = document.getElementById("unlock-password");
    this.elUnlockError = document.getElementById("unlock-error");
    this.elUnlockBtn = document.getElementById("btn-do-unlock");
    this.elPdfFrame = document.getElementById("pdf-viewer-frame");
    this.elPdfTitle = document.getElementById("pdf-modal-title");
    this.elPdfDownloadBtn = document.getElementById("btn-pdf-download");
  }

  _bindEvents() {
    // Escuta destravamento e travamento do cofre
    window.addEventListener("vault:unlocked", () => {
      this._updateHeaderStatus(true);
      this._showToast("🔓 Cofre destravado com sucesso!");
      this.render();
    });

    window.addEventListener("vault:locked", () => {
      this._updateHeaderStatus(false);
      this._showToast("🔒 Cofre trancado.");
      this.render();
    });

    // Botão de destravar no header
    this.elHeaderStatus.addEventListener("click", () => {
      if (vault.isUnlocked) {
        vault.lock();
      } else {
        this.openUnlockModal();
      }
    });

    // Submissão da senha do cofre
    this.elUnlockBtn.addEventListener("click", () => this._handleUnlockSubmit());
    this.elUnlockPasswordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this._handleUnlockSubmit();
    });

    // Fechar modais
    document.querySelectorAll("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => {
        this.closeModals();
      });
    });

    // Abas de navegação inferior
    document.querySelectorAll(".nav-tab").forEach(tab => {
      tab.addEventListener("click", (e) => {
        const tabKey = e.currentTarget.dataset.tab;
        this.switchTab(tabKey);
      });
    });

    // Arraste com o mouse / rolagem horizontal na trilha histórica (PC & Mobile)
    this._initMilestonesDrag();

    // Re-centralizar marco ativo caso o viewport seja redimensionado
    window.addEventListener("resize", () => {
      if (this.simulatedDate) {
        this._centerMilestone(this.simulatedDate);
      }
    });

    // Status de conexão
    window.addEventListener("online", () => this._updateOnlineStatus());
    window.addEventListener("offline", () => this._updateOnlineStatus());
    this._updateOnlineStatus();
  }

  _initMilestonesDrag() {
    const wrapper = this.elMilestonesTrackWrapper;
    if (!wrapper) return;

    let isDown = false;
    let startX = 0;
    let scrollStart = 0;
    let hasDragged = false;
    let isClickBlocked = false;
    const dragThreshold = 5; // px para distinguir clique acidental de arraste

    wrapper.addEventListener("mousedown", (e) => {
      // Ignorar cliques secundários (botão direito / roda central)
      if (e.button !== 0) return;
      isDown = true;
      hasDragged = false;
      isClickBlocked = false;
      startX = e.pageX;
      scrollStart = wrapper.scrollLeft;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      const dx = e.pageX - startX;

      if (!hasDragged && Math.abs(dx) > dragThreshold) {
        hasDragged = true;
        isClickBlocked = true;
        wrapper.classList.add("is-dragging");
      }

      if (hasDragged) {
        e.preventDefault();
        wrapper.scrollLeft = scrollStart - dx;
      }
    });

    const stopDrag = () => {
      if (!isDown) return;
      isDown = false;
      wrapper.classList.remove("is-dragging");
      if (isClickBlocked) {
        // Bloqueia clique fantasma gerado pelo navegador logo após mouseup
        setTimeout(() => {
          isClickBlocked = false;
          hasDragged = false;
        }, 60);
      }
    };

    window.addEventListener("mouseup", stopDrag);
    document.addEventListener("mouseleave", stopDrag);
    window.addEventListener("blur", stopDrag);

    // Evita arraste fantasma nativo do navegador em nós/ícones
    wrapper.addEventListener("dragstart", (e) => e.preventDefault());

    // Suporte para rolagem horizontal com a roda do mouse (wheel) no PC
    wrapper.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.ctrlKey) {
        e.preventDefault();
        wrapper.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Intercepta e cancela cliques na fase de captura caso tenha havido arraste
    wrapper.addEventListener("click", (e) => {
      if (isClickBlocked || hasDragged) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        isClickBlocked = false;
        hasDragged = false;
      }
    }, true);
  }

  async _loadPublicData() {
    try {
      const resp = await fetch("data/public-timeline.json");
      if (!resp.ok) throw new Error("Erro ao carregar dados públicos.");
      this.publicTimeline = await resp.json();
    } catch (err) {
      console.error(err);
      this._showToast("Erro ao carregar dados da viagem.");
    }
  }

  async _registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.register("sw.js");
        console.log("✓ Service Worker registrado:", reg.scope);
        // Força verificação imediata de atualizações no Service Worker
        reg.update().catch(() => {});

        if (navigator.storage && navigator.storage.persist) {
          const isPersisted = await navigator.storage.persist();
          console.log(`📦 Armazenamento persistente concedido: ${isPersisted}`);
        }
      } catch (err) {
        console.warn("Falha no Service Worker:", err);
      }
    }
  }

  _updateOnlineStatus() {
    if (navigator.onLine) {
      this.elOfflinePill.textContent = "● Online";
      this.elOfflinePill.style.color = "var(--accent-emerald)";
    } else {
      this.elOfflinePill.textContent = "○ Modo Offline";
      this.elOfflinePill.style.color = "var(--accent-amber)";
    }
  }

  _updateHeaderStatus(unlocked) {
    if (unlocked) {
      this.elHeaderStatus.className = "status-pill status-unlocked";
      this.elHeaderStatus.innerHTML = `<span>🔓</span> <span>Destravado</span>`;
    } else {
      this.elHeaderStatus.className = "status-pill status-locked";
      this.elHeaderStatus.innerHTML = `<span>🔒</span> <span>Destravar</span>`;
    }
  }

  _showToast(msg) {
    this.elToast.textContent = msg;
    this.elToast.classList.add("show");
    setTimeout(() => {
      this.elToast.classList.remove("show");
    }, 3000);
  }

  copyToClipboard(text, label = "Item") {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).then(() => {
        this._showToast(`✓ ${label} copiado!`);
        return true;
      }).catch(() => {
        return this._fallbackCopy(text, label);
      });
    } else {
      return Promise.resolve(this._fallbackCopy(text, label));
    }
  }

  _fallbackCopy(text, label) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (success) {
        this._showToast(`✓ ${label} copiado!`);
      } else {
        this._showToast(`Falha ao copiar.`);
      }
    } catch (_) {
      this._showToast(`Falha ao copiar.`);
    }
  }

  openUnlockModal() {
    this.elUnlockError.textContent = "";
    this.elUnlockPasswordInput.value = "";
    this.elUnlockModal.classList.add("open");
    setTimeout(() => this.elUnlockPasswordInput.focus(), 150);
  }

  async _handleUnlockSubmit() {
    const pwd = this.elUnlockPasswordInput.value.trim();
    if (!pwd) {
      this.elUnlockError.textContent = "Por favor, digite a senha mestre.";
      return;
    }

    this.elUnlockBtn.disabled = true;
    this.elUnlockBtn.textContent = "Derivando chaves (600k iterações)...";
    this.elUnlockError.textContent = "";

    try {
      await vault.unlock(pwd);
      const pending = this.pendingPdfRequest;
      this.pendingPdfRequest = null;
      this.closeModals();

      if (pending) {
        setTimeout(() => this.openPdf(pending.assetId, pending.title), 150);
      }
    } catch (err) {
      this.elUnlockError.textContent = "Senha incorreta ou integridade violada.";
    } finally {
      this.elUnlockBtn.disabled = false;
      this.elUnlockBtn.textContent = "Destravar Cofre";
    }
  }

  async openPdf(assetId, title = "Comprovante") {
    if (!vault.isUnlocked) {
      this.pendingPdfRequest = { assetId, title };
      this.openUnlockModal();
      return;
    }

    this._showToast("Decifrando documento em memória...");
    try {
      if (this.activePdfRevoke) {
        this.activePdfRevoke();
        this.activePdfRevoke = null;
      }

      const { url, revoke } = await vault.getPdfBlobUrl(assetId);
      this.activePdfRevoke = revoke;

      this.elPdfTitle.textContent = title;
      this.elPdfFrame.src = url;
      this.elPdfDownloadBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${assetId}.pdf`;
        a.click();
      };

      this.elPdfModal.classList.add("open");
    } catch (err) {
      this._showToast("Erro ao decifrar documento: " + err.message);
    }
  }

  closeModals() {
    this.elUnlockModal.classList.remove("open");
    this.elPdfModal.classList.remove("open");

    // Limpar iframe e revogar Blob URL com segurança
    if (this.elPdfFrame) {
      this.elPdfFrame.src = "about:blank";
    }
    if (this.activePdfRevoke) {
      this.activePdfRevoke();
      this.activePdfRevoke = null;
    }
    this.pendingPdfRequest = null;
  }

  switchTab(tabKey) {
    this.currentTab = tabKey;
    document.querySelectorAll(".nav-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tabKey);
    });
    this.render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  setSimulatedDate(dateStr, options = {}) {
    this.simulatedDate = dateStr;

    // Se estiver em outra aba e clicou em um marco de data, alterna para a timeline
    const needTabSwitch = Boolean(dateStr && this.currentTab !== "timeline");
    if (needTabSwitch) {
      this.currentTab = "timeline";
      document.querySelectorAll(".nav-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === "timeline");
      });
      this.render();
    } else {
      this._renderCurrentStep();
      this._renderMilestonesTrack();
      if (!this.elMainContainer.querySelector(".timeline-day")) {
        this._renderTabContent();
      }
    }

    if (dateStr) {
      this._centerMilestone(dateStr);
      if (options.scrollToDay !== false) {
        this._scrollToDay(dateStr);
      }
    } else {
      // Tempo Real (Hoje): rebobina trilha para o início
      const wrapper = this.elMilestonesTrackWrapper || document.querySelector(".milestones-track-wrapper");
      if (wrapper) {
        wrapper.scrollTo({ left: 0, behavior: "smooth" });
      }
      if (options.scrollToTop !== false) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  }

  _centerMilestone(dateStr) {
    if (!dateStr) return;
    const wrapper = this.elMilestonesTrackWrapper || document.querySelector(".milestones-track-wrapper");
    if (!wrapper) return;

    requestAnimationFrame(() => {
      const activeNode = wrapper.querySelector(`.milestone-node[data-date="${dateStr}"]`);
      if (!activeNode) return;

      const nodeRect = activeNode.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const targetScrollLeft = wrapper.scrollLeft + (nodeRect.left - wrapperRect.left) - (wrapper.clientWidth / 2) + (nodeRect.width / 2);

      const maxScroll = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
      const clampScroll = Math.max(0, Math.min(targetScrollLeft, maxScroll));

      wrapper.scrollTo({
        left: clampScroll,
        behavior: "smooth"
      });
    });
  }

  _scrollToDay(dateStr) {
    if (!dateStr) return;
    requestAnimationFrame(() => {
      const dayEl = document.getElementById(`day-${dateStr}`);
      if (!dayEl) return;

      const header = document.querySelector(".app-header");
      const headerHeight = header ? header.offsetHeight : 70;
      const elementRect = dayEl.getBoundingClientRect();
      const currentScrollY = window.scrollY || window.pageYOffset || 0;
      const absoluteTop = currentScrollY + elementRect.top - headerHeight - 16;

      window.scrollTo({
        top: Math.max(0, absoluteTop),
        behavior: "smooth"
      });

      // Efeito visual de destaque suave (âmbar)
      dayEl.classList.remove("timeline-day-highlight");
      void dayEl.offsetWidth; // Força reflow para reiniciar animação CSS
      dayEl.classList.add("timeline-day-highlight");
      setTimeout(() => {
        dayEl.classList.remove("timeline-day-highlight");
      }, 2200);
    });
  }

  render() {
    this._renderCurrentStep();
    this._renderImmigrationDocs();
    this._renderMilestonesTrack();
    this._renderTabContent();
  }

  _renderImmigrationDocs() {
    if (!this.elImmigrationDocsCard) return;

    const isUnlocked = vault.isUnlocked;
    const privateData = vault.getData();
    const tDiego = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "diego") : null;
    const tTatiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "tatiana") : null;
    const tFabiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "fabiana") : null;

    const diegoPassport = isUnlocked ? (tDiego?.passport || "GO506551") : null;
    const diegoOldPassport = isUnlocked ? (tDiego?.oldPassport || "FR302881") : null;
    const diegoApolice = isUnlocked ? (tDiego?.apolice || "16023-0003-69-260122474") : null;
    const diegoCert = isUnlocked ? (tDiego?.certSchengen || "32572804832") : null;

    const tatianaPassport = isUnlocked ? (tTatiana?.passport || "GB464034") : null;
    const tatianaApolice = isUnlocked ? (tTatiana?.apolice || "16023-0003-69-260122473") : null;
    const tatianaCert = isUnlocked ? (tTatiana?.certSchengen || "29340388828") : null;

    const fabianaPassport = isUnlocked ? (tFabiana?.passport || "G0872312") : null;
    const fabianaCredencial = isUnlocked ? (tFabiana?.credencial || "Mem 209/2026 – VIC") : null;

    this.elImmigrationDocsCard.innerHTML = `
      <div class="immigration-card-inner">
        <div class="immigration-card-header" id="immigration-card-header" onclick="app.toggleImmigrationDocs(event)">
          <div class="immigration-title-group">
            <div class="immigration-flag-badge" aria-hidden="true">🇵🇹</div>
            <div class="immigration-title-texts">
              <div class="immigration-tag">Controle de Fronteira • Espaço Schengen • Lisboa (LIS)</div>
              <h2 class="immigration-heading">Documentos de Imigração & Seguro Schengen (Entrada em Portugal)</h2>
            </div>
          </div>
          <div class="immigration-header-controls">
            <div class="immigration-status-badge">
              ${isUnlocked ? `
                <span class="badge-unlocked">🔓 Cofre Destravado</span>
              ` : `
                <button type="button" class="btn btn-primary btn-sm btn-unlock-fast" onclick="event.stopPropagation(); app.openUnlockModal()">
                  🔒 Destravar Cofre
                </button>
              `}
            </div>
            <button type="button" class="immigration-toggle-btn" id="immigration-toggle-btn" aria-expanded="${this.isImmigrationExpanded ? 'true' : 'false'}" aria-controls="immigration-card-body" aria-label="${this.isImmigrationExpanded ? 'Recolher detalhes de imigração' : 'Expandir detalhes de imigração'}">
              <span class="immigration-toggle-text">${this.isImmigrationExpanded ? 'Recolher' : 'Expandir'}</span>
              <span class="toggle-chevron ${this.isImmigrationExpanded ? 'open' : ''}">▼</span>
            </button>
          </div>
        </div>

        <div class="immigration-card-body-wrapper ${this.isImmigrationExpanded ? 'expanded' : 'collapsed'}" id="immigration-card-body-wrapper">
          <div class="immigration-card-body" id="immigration-card-body" aria-hidden="${!this.isImmigrationExpanded}">
            <p class="immigration-notice">
              <strong>Apresentação Obrigatória na Imigração & Viagem:</strong> Para ingressar em Portugal e no Espaço Schengen, apresente os passaportes brasileiros e os certificados de seguro viagem com cobertura médica/hospitalar mínima de <strong>€ 30.000</strong> (Porto Seguro). Abaixo constam também as Cartas de Convite oficiais e credenciais de Paz y Salvo para o Congresso em Toledo.
            </p>

            ${!isUnlocked ? `
              <div class="unlock-info-banner" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor: pointer;" title="Toque para destravar o cofre">
                <div class="unlock-info-content">
                  <div class="unlock-info-icon">🔒</div>
                  <div class="unlock-info-text">
                    <strong>Destrave para ver informações</strong>
                    <span>Passaportes, apólices de seguro e download de documentos estão protegidos. Toque para destravar com sua senha mestre.</span>
                  </div>
                </div>
                <button type="button" class="btn btn-primary btn-sm btn-unlock-touch" onclick="event.stopPropagation(); app.openUnlockModal()">
                  🔓 Destravar Cofre
                </button>
              </div>
            ` : ""}

            <div class="immigration-travelers-grid">
              <!-- Diego Jacob -->
              <div class="traveler-doc-box">
                <div class="traveler-header">
                  <div class="traveler-avatar">👤</div>
                  <div>
                    <strong class="traveler-name">Diego Jacob Fernandes Leite</strong>
                    <span class="traveler-role">Titular • Voo TAP TP110 • Sacerdote</span>
                  </div>
                </div>
                <div class="policy-details">
                  <div class="policy-row">
                    <span class="policy-label">Passaporte Brasileiro:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${diegoPassport} <button type="button" class="copy-icon-btn" title="Copiar passaporte atual" onclick="event.stopPropagation(); app.copyToClipboard('${diegoPassport}', 'Passaporte Diego')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Passaporte Anterior:</span>
                    ${isUnlocked ? `
                      <span class="policy-val policy-val-muted">${diegoOldPassport} <button type="button" class="copy-icon-btn" title="Copiar passaporte anterior" onclick="event.stopPropagation(); app.copyToClipboard('${diegoOldPassport}', 'Passaporte Antigo Diego')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Apólice Porto Seguro:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${diegoApolice} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${diegoApolice}', 'Apólice Diego')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">•••••••••••••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Certificado Schengen:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${diegoCert} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${diegoCert}', 'Certificado Diego')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">•••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                </div>
                <div class="traveler-actions">
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">
                    📄 Bilhete Seguro Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">
                    📄 Certificado Schengen Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-convite-diego', 'Carta de Invitación - Diego Jacob Fernandes Leite')">
                    📄 Carta Convite Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
                    📄 Paz y Salvo ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                </div>
              </div>

              <!-- Tatiana Jacob -->
              <div class="traveler-doc-box">
                <div class="traveler-header">
                  <div class="traveler-avatar">👤</div>
                  <div>
                    <strong class="traveler-name">Tatiana Araujo de Sousa Jacob</strong>
                    <span class="traveler-role">Esposa / Segurada • Voo TAP TP110 • Isis</span>
                  </div>
                </div>
                <div class="policy-details">
                  <div class="policy-row">
                    <span class="policy-label">Passaporte Brasileiro:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${tatianaPassport} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${tatianaPassport}', 'Passaporte Tatiana')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Apólice Porto Seguro:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${tatianaApolice} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${tatianaApolice}', 'Apólice Tatiana')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">•••••••••••••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Certificado Schengen:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${tatianaCert} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${tatianaCert}', 'Certificado Tatiana')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">•••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                </div>
                <div class="traveler-actions">
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">
                    📄 Bilhete Seguro Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">
                    📄 Certificado Schengen Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-convite-tatiana', 'Carta de Invitación - Tatiana Araújo de Sousa Jacob')">
                    📄 Carta Convite Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
                    📄 Paz y Salvo ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                </div>
              </div>

              <!-- Fabiana Poli -->
              <div class="traveler-doc-box">
                <div class="traveler-header">
                  <div class="traveler-avatar">👤</div>
                  <div>
                    <strong class="traveler-name">Fabiana Nunes Poli</strong>
                    <span class="traveler-role">Congressista • Lumisial Zeus Daimon • Isis</span>
                  </div>
                </div>
                <div class="policy-details">
                  <div class="policy-row">
                    <span class="policy-label">Passaporte Brasileiro:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${fabianaPassport} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${fabianaPassport}', 'Passaporte Fabiana')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Credencial Congresso:</span>
                    ${isUnlocked ? `
                      <span class="policy-val">${fabianaCredencial} <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${fabianaCredencial}', 'Credencial Fabiana')">📋</button></span>
                    ` : `
                      <span class="policy-val locked-val text-muted" onclick="event.stopPropagation(); app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar"><span class="locked-asterisks">••••••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                    `}
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Lumisial / Grau:</span>
                    <span class="policy-val" style="font-family: inherit; font-size: 0.76rem; color: var(--text-muted);">Zeus Daimon • Isis</span>
                  </div>
                </div>
                <div class="traveler-actions">
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-pazsalvo-fabiana', 'Paz y Salvo - Fabiana Nunes Poli')">
                    📄 Paz y Salvo Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-aireuropa-fabiana', 'Voo Air Europa - Fabiana Nunes Poli')">
                    ✈️ Voo Air Europa Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                  </button>
                </div>
              </div>
            </div>

            ${!isUnlocked ? `
              <div class="immigration-lock-hint" onclick="event.stopPropagation(); app.openUnlockModal()">
                <span>🔒 PDFs e dados confidenciais protegidos com criptografia AES-256-GCM. Toque em qualquer documento ou <strong>aqui para destravar com sua senha mestre</strong>.</span>
              </div>
            ` : `
              <div class="immigration-unlocked-hint">
                <span>✓ Apólices e certificados decifrados em memória (RAM) • Toque em qualquer botão para visualização imediata ou download offline.</span>
              </div>
              ${privateData && privateData.travelers ? `
                <div class="immigration-unlocked-travelers" style="margin-top: 10px; padding: 10px 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: var(--radius-sm); font-size: 0.82rem; color: var(--accent-emerald); line-height: 1.5;">
                  <div style="font-weight: 600; margin-bottom: 4px;">✓ Dossiê de Viajantes Decifrado & Confirmado no Cofre EV26:</div>
                  <div style="display: flex; flex-direction: column; gap: 4px; color: var(--text-main);">
                    ${privateData.travelers.map(t => `
                      <div>• <strong>${t.name}</strong> (${t.role}): Passaporte <code>${t.passportStatus || t.passport}</code> <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('${t.passport}', 'Passaporte ${t.name}')">📋</button></div>
                    `).join("")}
                  </div>
                </div>
              ` : ""}
            `}
          </div>
        </div>
      </div>
    `;

    this._updateImmigrationAccordionState();
  }

  toggleImmigrationDocs(e) {
    if (e && e.target) {
      if (
        e.target.closest('.btn-unlock-fast') ||
        e.target.closest('.immigration-status-badge') ||
        e.target.closest('.copy-icon-btn') ||
        e.target.closest('.doc-action-btn') ||
        e.target.closest('.immigration-lock-hint')
      ) {
        return;
      }
    }
    this.isImmigrationExpanded = !this.isImmigrationExpanded;
    this._updateImmigrationAccordionState();
  }

  expandImmigrationDocs() {
    if (!this.isImmigrationExpanded) {
      this.isImmigrationExpanded = true;
      this._updateImmigrationAccordionState();
    }
  }

  collapseImmigrationDocs() {
    if (this.isImmigrationExpanded) {
      this.isImmigrationExpanded = false;
      this._updateImmigrationAccordionState();
    }
  }

  _updateImmigrationAccordionState() {
    const card = this.elImmigrationDocsCard;
    if (!card) return;

    const wrapper = card.querySelector(".immigration-card-body-wrapper");
    const body = card.querySelector(".immigration-card-body");
    const toggleBtn = card.querySelector(".immigration-toggle-btn");
    const toggleText = card.querySelector(".immigration-toggle-text");
    const chevron = card.querySelector(".toggle-chevron");

    if (this.isImmigrationExpanded) {
      card.classList.remove("is-collapsed");
      card.classList.add("is-expanded");
      if (wrapper) {
        wrapper.classList.remove("collapsed");
        wrapper.classList.add("expanded");
      }
      if (body) {
        body.setAttribute("aria-hidden", "false");
      }
      if (toggleBtn) {
        toggleBtn.setAttribute("aria-expanded", "true");
        toggleBtn.setAttribute("aria-label", "Recolher detalhes de imigração");
      }
      if (toggleText) {
        toggleText.textContent = "Recolher";
      }
      if (chevron) {
        chevron.classList.add("open");
        chevron.textContent = "▼";
      }
    } else {
      card.classList.remove("is-expanded");
      card.classList.add("is-collapsed");
      if (wrapper) {
        wrapper.classList.remove("expanded");
        wrapper.classList.add("collapsed");
      }
      if (body) {
        body.setAttribute("aria-hidden", "true");
      }
      if (toggleBtn) {
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.setAttribute("aria-label", "Expandir detalhes de imigração");
      }
      if (toggleText) {
        toggleText.textContent = "Expandir";
      }
      if (chevron) {
        chevron.classList.remove("open");
        chevron.textContent = "▼";
      }
    }
  }

  scrollToImmigrationDocs() {
    this.expandImmigrationDocs();
    const el = document.getElementById("immigration-docs-card");
    if (!el) return;
    const header = document.querySelector(".app-header");
    const headerHeight = header ? header.offsetHeight : 60;
    const elementRect = el.getBoundingClientRect();
    const currentScrollY = window.scrollY || window.pageYOffset || 0;
    const absoluteTop = currentScrollY + elementRect.top - headerHeight - 14;
    window.scrollTo({ top: Math.max(0, absoluteTop), behavior: "smooth" });
    el.classList.remove("card-highlight");
    void el.offsetWidth;
    el.classList.add("card-highlight");
    setTimeout(() => el.classList.remove("card-highlight"), 2200);
  }

  _renderCurrentStep() {
    const privateData = vault.getData();
    const bookings = privateData ? privateData.bookings : [];

    let targetTime = null;
    if (this.simulatedDate) {
      const tzOffset = this.simulatedDate >= "2026-10-25" ? "+01:00" : "+02:00";
      targetTime = `${this.simulatedDate}T10:30:00${tzOffset}`;
    }

    const step = computeCurrentStep(bookings, targetTime);

    if (!step.event) {
      this.elCurrentStepCard.innerHTML = `
        <div class="step-card-header">
          <span class="step-badge amber">Visão Geral</span>
          <span class="countdown-timer">Europa 2026</span>
        </div>
        <h2 class="step-title">Pronto para o Embarque em Florianópolis</h2>
        <p class="step-details">
          <span>📅 17 a 30 de Outubro de 2026</span> • <span>3 Viajantes (Diego, Tatiana e Fabiana)</span>
        </p>
        <div class="step-actions">
          <button class="btn btn-primary btn-sm" onclick="app.setSimulatedDate('2026-10-17')">Simular Dia da Partida (17/Out)</button>
          <button class="btn btn-secondary btn-sm" onclick="app.scrollToImmigrationDocs()">🛂 Seguros Imigração Lisboa</button>
          <a href="https://www.flytap.com/pt-br/check-in" target="_blank" rel="noopener noreferrer" class="btn btn-checkin-tap btn-sm">🛫 Check-in TAP ↗</a>
          <button class="btn btn-secondary btn-sm" onclick="app.prepareOffline()">Preparar Modo Avião (Offline)</button>
        </div>
      `;
      return;
    }

    const evt = step.event;
    const isUnlocked = vault.isUnlocked;

    let actionButtonsHtml = "";
    if (evt.pnr) {
      actionButtonsHtml += `
        <button class="btn btn-primary btn-sm" onclick="app.copyToClipboard('${evt.pnr}', 'Localizador')">
          📋 Copiar Localizador (${evt.pnr})
        </button>
      `;
    } else if (evt.bookingRef) {
      actionButtonsHtml += `
        <button class="btn btn-primary btn-sm" onclick="app.copyToClipboard('${evt.bookingRef}', 'Reserva')">
          📋 Copiar Reserva (${evt.bookingRef})
        </button>
      `;
    }

    // Botão direto de Check-in da Companhia Aérea
    if (evt.category === "flight" || evt.checkinUrl) {
      const isTap = (evt.airline && evt.airline.includes("TAP")) || (evt.flightNumber && evt.flightNumber.startsWith("TP"));
      const checkinUrl = evt.checkinUrl || (isTap ? "https://www.flytap.com/pt-br/check-in" : "https://www.aireuropa.com/br/pt/aea/check-in-online.html");
      const ciaName = isTap ? "TAP Oficial" : "Air Europa";
      actionButtonsHtml += `
        <a href="${checkinUrl}" target="_blank" rel="noopener noreferrer" class="btn ${isTap ? 'btn-checkin-tap' : 'btn-checkin'} btn-sm">
          🛫 Fazer Check-in ${ciaName} ↗
        </a>
      `;
    }

    if (evt.phone) {
      const waDigits = evt.phone.replace(/\D/g, "");
      actionButtonsHtml += `
        <a href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" title="Conversar no WhatsApp">
          💬 WhatsApp (${evt.phone}) ↗
        </a>
        <a href="tel:${evt.phone}" class="btn btn-secondary btn-sm" title="Fazer ligação de voz">
          📞 Ligar
        </a>
      `;
    } else if (evt.hostPhone) {
      const waDigits = evt.hostPhone.replace(/\D/g, "");
      actionButtonsHtml += `
        <a href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm" title="Conversar no WhatsApp">
          💬 WhatsApp ${evt.host || 'Anfitrião'} (${evt.hostPhone}) ↗
        </a>
        <a href="tel:${evt.hostPhone}" class="btn btn-secondary btn-sm" title="Fazer ligação de voz">
          📞 Ligar
        </a>
      `;
    }

    if (evt.mapsUrl) {
      actionButtonsHtml += `
        <a href="${evt.mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:4px;">
          🗺️ Rota no Google Maps ↗
        </a>
      `;
    }

    if (evt.category === "temple" || evt.id === "templo-divino-daimon-valais") {
      actionButtonsHtml += `
        <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
          📄 Paz y Salvo Diego & Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
        </button>
        <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-fabiana', 'Paz y Salvo - Fabiana Nunes Poli')">
          📄 Paz y Salvo Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
        </button>
      `;
    } else if (evt.protectedId === "car-rental-genebra" || evt.category === "car") {
      actionButtonsHtml += `
        <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-carro-suica', 'Voucher Aluguel de Carro - Skoda Fabia')">
          📄 Voucher Aluguel Carro ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
        </button>
        <button class="btn btn-secondary btn-sm" onclick="app.switchTab('car')">
          🚗 Ver Detalhes do Carro & Balcão
        </button>
      `;
    } else if (evt.documents && evt.documents.length > 0) {
      actionButtonsHtml += `
        <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('${evt.documents[0]}', '${evt.title}')">
          📄 Ver Voucher PDF ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
        </button>
      `;
    }

    // Acesso rápido a documentos de imigração se o voo chega em Lisboa ou estiver no dia 17/Out
    if ((evt.arrival && evt.arrival.airport === "LIS") || (evt.id && evt.id.includes("flight-tap-ida")) || this.simulatedDate === "2026-10-17") {
      actionButtonsHtml += `
        <button class="btn btn-secondary btn-sm" onclick="app.scrollToImmigrationDocs()">
          🛂 Imigração Lisboa & Seguros
        </button>
      `;
    }

    this.elCurrentStepCard.innerHTML = `
      <div class="step-card-header">
        <span class="step-badge ${step.badgeColor}">${step.status}</span>
        ${step.countdown ? `<span class="countdown-timer">⏱️ ${step.countdown}</span>` : ""}
      </div>
      <h2 class="step-title">${evt.title}</h2>
      <div class="step-details">
        <div class="detail-item">
          <span>🕒</span> <strong>${step.startFormatted}</strong> ${step.endFormatted ? `➔ <strong>${step.endFormatted}</strong>` : ""} (${step.tzLabel})
        </div>
        ${evt.address ? `<div class="detail-item"><span>📍</span> ${evt.address}</div>` : ""}
        ${evt.criticalNotice ? `<div class="detail-item" style="color:var(--accent-amber);font-weight:600;">${evt.criticalNotice}</div>` : ""}
        ${evt.credentials ? `<div class="detail-item" style="color:var(--accent-emerald);"><span>🕊️</span> <strong>Credenciais:</strong> ${evt.credentials}</div>` : ""}
        ${evt.recommendations ? `<div class="detail-item" style="font-size:0.82rem;color:var(--text-muted);"><span>✨</span> <strong>Recomendações:</strong> ${evt.recommendations}</div>` : ""}
      </div>
      <div class="step-actions">
        ${actionButtonsHtml}
      </div>
    `;
  }

  _renderMilestonesTrack() {
    if (!this.elMilestonesTrack) return;

    const milestones = [
      {
        date: "2026-10-17",
        icon: "🛫",
        dateLabel: "17/Out",
        title: "Partida Brasil",
        tag: "Voo TAP",
        city: "FLN ➔ MAD"
      },
      {
        date: "2026-10-18",
        icon: "🏔️",
        dateLabel: "18/Out",
        title: "Alpes Suíços",
        tag: "Suíça",
        city: "GVA ➔ Saillon"
      },
      {
        date: "2026-10-19",
        icon: "🏛️",
        dateLabel: "19/Out",
        title: "Templo Daimon",
        tag: "Riddes Valais",
        city: "Saillon ➔ Riddes"
      },
      {
        date: "2026-10-20",
        icon: "🇪🇸",
        dateLabel: "20/Out",
        title: "Retorno Madrid",
        tag: "Espanha",
        city: "Madrid Rio"
      },
      {
        date: "2026-10-22",
        icon: "🎓",
        dateLabel: "22/Out",
        title: "Congresso Toledo",
        tag: "Congresso",
        city: "Mirador del Valle"
      },
      {
        date: "2026-10-25",
        icon: "⏰",
        dateLabel: "25/Out",
        title: "Virada de Fuso",
        tag: "Fim DST",
        city: "CEST ➔ CET"
      },
      {
        date: "2026-10-28",
        icon: "🏨",
        dateLabel: "28/Out",
        title: "Apto Toledo",
        tag: "Toledo",
        city: "Centro Toledo"
      },
      {
        date: "2026-10-29",
        icon: "🇵🇹",
        dateLabel: "29/Out",
        title: "Conexão Lisboa",
        tag: "Portugal",
        city: "Central Lisbon"
      },
      {
        date: "2026-10-30",
        icon: "🏠",
        dateLabel: "30/Out",
        title: "Voo Brasil",
        tag: "Retorno",
        city: "LIS ➔ FLN"
      }
    ];

    const isLive = !this.simulatedDate;
    if (this.elBtnLiveTime) {
      this.elBtnLiveTime.classList.toggle("active", isLive);
    }

    // Se os nós dos marcos já existem no DOM, apenas atualiza estados active e aria-current
    const existingButtons = this.elMilestonesTrack.querySelectorAll(".milestone-node");
    if (existingButtons.length === milestones.length) {
      existingButtons.forEach(btn => {
        const isActive = this.simulatedDate === btn.dataset.date;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-current", isActive ? "step" : "false");
      });
      return;
    }

    this.elMilestonesTrack.innerHTML = milestones.map(m => {
      const isActive = this.simulatedDate === m.date;
      return `
        <button class="milestone-node ${isActive ? 'active' : ''}" 
                data-date="${m.date}" 
                onclick="app.setSimulatedDate('${m.date}')"
                title="${m.title} (${m.city})"
                aria-current="${isActive ? 'step' : 'false'}">
          <div class="milestone-marker">
            <span>${m.icon}</span>
          </div>
          <div class="milestone-date">${m.dateLabel}</div>
          <div class="milestone-title">${m.title}</div>
          <div class="milestone-tag">${m.tag}</div>
        </button>
      `;
    }).join("");
  }

  _renderTabContent() {
    if (this.currentTab === "timeline") {
      this._renderTimelineView();
    } else if (this.currentTab === "flights") {
      this._renderFlightsView();
    } else if (this.currentTab === "stays") {
      this._renderStaysView();
    } else if (this.currentTab === "car") {
      this._renderCarView();
    } else if (this.currentTab === "congress") {
      this._renderCongressView();
    } else if (this.currentTab === "emergency") {
      this._renderEmergencyView();
    }
  }

  _renderTimelineView() {
    if (!this.publicTimeline) {
      this.elMainContainer.innerHTML = `<p class="text-dim">Carregando cronograma...</p>`;
      return;
    }

    const privateData = vault.getData();
    const isUnlocked = vault.isUnlocked;
    const tDiego = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "diego") : null;
    const tTatiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "tatiana") : null;
    const tFabiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "fabiana") : null;

    let html = `
      <div class="timeline-section-title">
        <span>📅 Itinerário Completo Dia a Dia</span>
        <button class="btn btn-secondary btn-sm" onclick="app.prepareOffline()">Preparar Modo Avião</button>
      </div>
    `;

    this.publicTimeline.days.forEach(day => {
      html += `
        <div class="timeline-day" id="day-${day.date}" data-date="${day.date}">
          <div class="day-header">
            <span class="day-title">${formatDateInZone(day.date + "T12:00:00", "Europe/Madrid")}</span>
            <span class="day-city">${day.city}</span>
          </div>
          <div class="events-list">
      `;

      day.events.forEach(evt => {
        let privateBooking = null;
        if (isUnlocked && privateData && evt.protectedId) {
          privateBooking = privateData.bookings.find(b => b.id === evt.protectedId);
        }

        const catClass = `category-${evt.category || 'stay'}`;

        html += `
          <div class="event-card">
            <div class="event-card-top">
              <div class="event-meta">
                <span class="event-time">${evt.time}</span>
                <span class="category-tag ${catClass}">${evt.category}</span>
              </div>
            </div>
            <div class="event-name">${evt.title}</div>
        `;

        if (evt.isImmigration || evt.protectedId === "immigration-lisboa") {
          html += `
            <div class="secret-badge" style="border-left: 3px solid var(--accent-amber); margin-top: 10px;">
              <div style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 8px;">
                🛂 <strong>Controle de Fronteira & Entrada no Espaço Schengen (Lisboa - LIS)</strong><br>
                <span style="font-size: 0.8rem; color: var(--text-muted);">
                  Apresentação obrigatória na imigração: Passaporte brasileiro e apólice de seguro viagem com cobertura médica mínima de <strong>€ 30.000</strong> (Porto Seguro).
                </span>
              </div>
              <div class="secret-grid" style="margin-bottom: 10px;">
                ${isUnlocked && tDiego ? `
                  <div class="secret-item">
                    <span class="secret-label">Diego Jacob (Titular)</span>
                    <span class="secret-value">Passaporte NOVO: ${tDiego.passport} (antigo: ${tDiego.oldPassport || ''}) <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tDiego.passport}', 'Passaporte Diego')">📋</button> <button type="button" class="copy-icon-btn" title="Copiar passaporte antigo" onclick="app.copyToClipboard('${tDiego.oldPassport || ''}', 'Passaporte Antigo Diego')">📋 (antigo)</button><br>Apólice: ${tDiego.apolice || ''} (Cert: ${tDiego.certSchengen || ''})</span>
                  </div>
                ` : `
                  <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                    <span class="secret-label">Diego Jacob (Titular)</span>
                    <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                  </div>
                `}
                ${isUnlocked && tTatiana ? `
                  <div class="secret-item">
                    <span class="secret-label">Tatiana Jacob (Esposa)</span>
                    <span class="secret-value">Passaporte: ${tTatiana.passport} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tTatiana.passport}', 'Passaporte Tatiana')">📋</button><br>Apólice: ${tTatiana.apolice || ''} (Cert: ${tTatiana.certSchengen || ''})</span>
                  </div>
                ` : `
                  <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                    <span class="secret-label">Tatiana Jacob (Esposa)</span>
                    <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                  </div>
                `}
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">
                  📄 Bilhete Seguro Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">
                  📄 Certificado Schengen Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">
                  📄 Bilhete Seguro Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">
                  📄 Certificado Schengen Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-convite-diego', 'Carta de Invitación - Diego Jacob Fernandes Leite')">
                  📄 Carta Convite Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-convite-tatiana', 'Carta de Invitación - Tatiana Araújo de Sousa Jacob')">
                  📄 Carta Convite Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn btn-secondary btn-sm" onclick="app.scrollToImmigrationDocs()">
                  ⬆️ Ver Card de Imigração no Topo
                </button>
              </div>
            </div>
          `;
        } else if (evt.isCongressCheckin || (evt.protectedId === "stay-toledo-congresso" && day.date === "2026-10-22")) {
          html += `
            <div class="secret-badge" style="border-left: 3px solid var(--accent-emerald); margin-top: 10px;">
              <div style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 8px;">
                🎓 <strong>Credenciamento do Congresso & Documentação Oficial (Toledo)</strong><br>
                <span style="font-size: 0.8rem; color: var(--text-muted);">
                  Apresentar na recepção / credenciamento do Palacio de Congresos El Greco: Cartas de Convite oficiais da Igreja Gnóstica e certificados de Paz y Salvo da delegação (Lumisial Zeus Daimon).
                </span>
              </div>
              <div class="secret-grid" style="margin-bottom: 10px;">
                ${isUnlocked && tDiego ? `
                  <div class="secret-item">
                    <span class="secret-label">Diego Jacob (Sacerdote)</span>
                    <span class="secret-value">Passaporte NOVO: ${tDiego.passport} (antigo: ${tDiego.oldPassport || 'FR302881'}) <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tDiego.passport}', 'Passaporte Diego')">📋</button> <button type="button" class="copy-icon-btn" title="Copiar passaporte antigo" onclick="app.copyToClipboard('${tDiego.oldPassport || 'FR302881'}', 'Passaporte Antigo Diego')">📋 (antigo)</button></span>
                  </div>
                ` : `
                  <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                    <span class="secret-label">Diego Jacob (Sacerdote)</span>
                    <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                  </div>
                `}
                ${isUnlocked && tTatiana ? `
                  <div class="secret-item">
                    <span class="secret-label">Tatiana Araújo (Isis)</span>
                    <span class="secret-value">Passaporte: ${tTatiana.passport} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tTatiana.passport}', 'Passaporte Tatiana')">📋</button></span>
                  </div>
                ` : `
                  <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                    <span class="secret-label">Tatiana Araújo (Isis)</span>
                    <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                  </div>
                `}
                ${isUnlocked && tFabiana ? `
                  <div class="secret-item">
                    <span class="secret-label">Fabiana Poli (Isis)</span>
                    <span class="secret-value">Passaporte: ${tFabiana.passport} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tFabiana.passport}', 'Passaporte Fabiana')">📋</button></span>
                  </div>
                ` : `
                  <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                    <span class="secret-label">Fabiana Poli (Isis)</span>
                    <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
                  </div>
                `}
                <div class="secret-item">
                  <span class="secret-label">Credenciais Paz y Salvo</span>
                  <span class="secret-value">${isUnlocked && tFabiana?.credencial ? `Mem 207/2026 & ${tFabiana.credencial} (Zeus Daimon)` : `VIC 207/2026 & VIC 209/2026 (Zeus Daimon)`}</span>
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-convite-diego', 'Carta de Invitación - Diego Jacob Fernandes Leite')">
                  📄 Carta Convite Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-convite-tatiana', 'Carta de Invitación - Tatiana Araújo de Sousa Jacob')">
                  📄 Carta Convite Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
                  📄 Paz y Salvo Diego & Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-fabiana', 'Paz y Salvo - Fabiana Nunes Poli')">
                  📄 Paz y Salvo Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-hotel-toledo', 'El Mirador del Valle - Reserva Hotel Toledo')">
                  🏨 Voucher Hotel Toledo ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
              </div>
            </div>
          `;
          if (isUnlocked && privateBooking) {
            html += `
              <div class="secret-badge" style="margin-top: 8px;">
                <div class="secret-grid">
                  ${privateBooking.bookingRef ? `
                    <div class="secret-item">
                      <span class="secret-label">Código de Reserva Booking</span>
                      <span class="secret-value">${privateBooking.bookingRef} <button class="copy-icon-btn" onclick="app.copyToClipboard('${privateBooking.bookingRef}', 'Reserva')">📋</button></span>
                    </div>
                  ` : ""}
                  ${privateBooking.pin ? `
                    <div class="secret-item">
                      <span class="secret-label">Código PIN</span>
                      <span class="secret-value">${privateBooking.pin}</span>
                    </div>
                  ` : ""}
                  ${privateBooking.phone ? `
                    <div class="secret-item">
                      <span class="secret-label">Telefone Hotel Toledo</span>
                      <span class="secret-value">
                        <a href="https://wa.me/${privateBooking.phone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link" title="Abrir conversa no WhatsApp">
                          💬 ${privateBooking.phone} ↗
                        </a>
                      </span>
                    </div>
                  ` : ""}
                  ${privateBooking.address ? `
                    <div class="secret-item" style="grid-column: 1 / -1;">
                      <span class="secret-label">Endereço Toledo</span>
                      <span class="secret-value">${privateBooking.address} <button class="copy-icon-btn" onclick="app.copyToClipboard('${privateBooking.address}', 'Endereço')">📋</button></span>
                    </div>
                  ` : ""}
                </div>
              </div>
            `;
          }
        } else if (evt.isDaimonVisit || evt.protectedId === "templo-divino-daimon-valais" || (day.date === "2026-10-19" && evt.title.includes("Templo Divino Daimon"))) {
          html += `
            <div class="secret-badge" style="border-left: 3px solid var(--accent-emerald); margin-top: 10px;">
              <div style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 8px;">
                🏛️ <strong>Visita Fraternal ao Templo Divino Daimon (Riddes, Valais • Suíça)</strong><br>
                <span style="font-size: 0.8rem; color: var(--text-muted);">
                  Deslocamento rápido entre cidades vizinhas no Cantão de Valais: <strong>Saillon ➔ Riddes</strong> (~4 km / cerca de 6 a 8 minutos de carro via Route de Saillon / Pont de Riddes sobre o Rio Ródano).
                </span>
              </div>
              <div class="secret-grid" style="margin-bottom: 10px;">
                <div class="secret-item">
                  <span class="secret-label">Confirmações & Credenciais</span>
                  <span class="secret-value">Paz y Salvo Institucional Zeus Daimon (Mem 207/2026 Diego & Tatiana • Mem 209/2026 Fabiana)</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Recomendações Litúrgicas</span>
                  <span class="secret-value">Trajes litúrgicos (vestes sacerdotais e de Isis), pontualidade suíça, respeito às diretrizes do templo irmão</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Participantes Oficiais</span>
                  <span class="secret-value">Diego Jacob (Sacerdote) • Tatiana Araújo (Isis) • Fabiana Poli (Isis)</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Localização & Trajeto</span>
                  <span class="secret-value">Riddes, Cantão de Valais, Suíça • Travessia da Pont de Riddes sobre o Rio Ródano</span>
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
                  📄 Paz y Salvo Diego & Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-fabiana', 'Paz y Salvo - Fabiana Nunes Poli')">
                  📄 Paz y Salvo Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
                </button>
                <a href="https://www.google.com/maps/dir/?api=1&origin=Vers+le+Scex+3,+Saillon,+Switzerland&destination=Riddes,+Switzerland&travelmode=driving" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                  🗺️ Rota Saillon ➔ Riddes (Google Maps) ↗
                </a>
              </div>
            </div>
          `;
        } else if (evt.isTrain || (evt.category === "transport" && evt.title.includes("Trem"))) {
          const isIda = day.date === "2026-10-22";
          html += `
            <div class="secret-badge" style="border-left: 3px solid var(--accent-sky); margin-top: 10px;">
              <div style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 6px;">
                🚄 <strong>Trem de Alta Velocidade: Renfe Avant (${isIda ? 'Madrid-Atocha ➔ Toledo' : 'Toledo ➔ Madrid-Atocha'})</strong><br>
                <span style="font-size: 0.8rem; color: var(--text-muted);">
                  ${isIda ? 
                    'Viagem rápida de alta velocidade de apenas <strong>33 minutos</strong> entre Madrid Puerta de Atocha e Toledo. Horário recomendado: ~13:50 ou 14:50 para check-in às 16:00 em Toledo.' : 
                    'Viagem de <strong>33 minutos</strong> até Madrid-Atocha. O bilhete Avant inclui <strong>Combinado Cercanías Grátis</strong> (linhas C-1 / C-10 até Aeroporto T4). Para T1/T2, há táxi tarifa fixa (€ 33) ou ônibus de conexão gratuito.'}
                </span>
              </div>
              <div class="secret-grid" style="margin-bottom: 8px;">
                <div class="secret-item">
                  <span class="secret-label">Status do Bilhete</span>
                  <span class="secret-value" style="color: var(--accent-amber);">Aguardando Compra • Promoção Ida y Vuelta</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Desconto Renfe</span>
                  <span class="secret-value">20% de desconto na volta comprando ida e volta juntas</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Estação em Madrid</span>
                  <span class="secret-value">Madrid - Puerta de Atocha Almudena Grandes</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Estação em Toledo</span>
                  <span class="secret-value">Estación de Tren de Toledo (Paseo de la Rosa)</span>
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                <a href="https://www.renfe.com/es/es" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                  🚄 Consultar Horários na Renfe Oficial ↗
                </a>
                <a href="https://www.thetrainline.com/pt-br" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                  🎟️ Consultar no Trainline ↗
                </a>
                <a href="https://www.google.com/maps/search/?api=1&query=Estacion+de+Tren+de+Toledo" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
                  📍 Estação Toledo no Maps ↗
                </a>
              </div>
            </div>
          `;
        } else if (isUnlocked && privateBooking) {
          html += `
            <div class="secret-badge">
              <div class="secret-grid">
                ${privateBooking.pnr ? `
                  <div class="secret-item">
                    <span class="secret-label">Localizador (PNR)</span>
                    <span class="secret-value">${privateBooking.pnr} <button class="copy-icon-btn" onclick="app.copyToClipboard('${privateBooking.pnr}', 'Localizador')">📋</button></span>
                  </div>
                ` : ""}
                ${privateBooking.bookingRef ? `
                  <div class="secret-item">
                    <span class="secret-label">Código de Reserva</span>
                    <span class="secret-value">${privateBooking.bookingRef} <button class="copy-icon-btn" onclick="app.copyToClipboard('${privateBooking.bookingRef}', 'Reserva')">📋</button></span>
                  </div>
                ` : ""}
                ${privateBooking.pin ? `
                  <div class="secret-item">
                    <span class="secret-label">Código PIN</span>
                    <span class="secret-value">${privateBooking.pin}</span>
                  </div>
                ` : ""}
                ${privateBooking.phone ? `
                  <div class="secret-item">
                    <span class="secret-label">Telefone / WhatsApp</span>
                    <span class="secret-value">
                      <a href="https://wa.me/${privateBooking.phone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link" title="Abrir conversa no WhatsApp">
                        💬 ${privateBooking.phone} ↗
                      </a>
                    </span>
                  </div>
                ` : ""}
                ${privateBooking.hostPhone ? `
                  <div class="secret-item">
                    <span class="secret-label">Anfitrião / WhatsApp</span>
                    <span class="secret-value">
                      <a href="https://wa.me/${privateBooking.hostPhone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link" title="Abrir conversa no WhatsApp com anfitrião">
                        💬 ${privateBooking.host} (${privateBooking.hostPhone}) ↗
                      </a>
                    </span>
                  </div>
                ` : ""}
                ${privateBooking.address ? `
                  <div class="secret-item" style="grid-column: 1 / -1;">
                    <span class="secret-label">Endereço Completo</span>
                    <span class="secret-value">${privateBooking.address} <button class="copy-icon-btn" onclick="app.copyToClipboard('${privateBooking.address}', 'Endereço')">📋</button></span>
                  </div>
                ` : ""}
              </div>
              ${(privateBooking.documents && privateBooking.documents.length > 0) || privateBooking.phone || privateBooking.hostPhone || privateBooking.id === 'flight-tap-ida-1' ? `
                <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                  ${privateBooking.category === 'flight' || privateBooking.checkinUrl ? `
                    <a href="${privateBooking.checkinUrl || (privateBooking.airline && privateBooking.airline.includes('Air Europa') ? 'https://www.aireuropa.com/br/pt/aea/check-in-online.html' : 'https://www.flytap.com/pt-br/check-in')}" target="_blank" rel="noopener noreferrer" class="btn ${privateBooking.airline && privateBooking.airline.includes('Air Europa') ? 'btn-checkin' : 'btn-checkin-tap'} btn-sm">
                      🛫 Fazer Check-in Online ↗
                    </a>
                  ` : ""}
                  ${privateBooking.phone ? `
                    <a href="https://wa.me/${privateBooking.phone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm">
                      💬 Conversar no WhatsApp ↗
                    </a>
                  ` : ""}
                  ${privateBooking.hostPhone ? `
                    <a href="https://wa.me/${privateBooking.hostPhone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm">
                      💬 WhatsApp ${privateBooking.host || 'Anfitrião'} ↗
                    </a>
                  ` : ""}
                  ${privateBooking.documents ? privateBooking.documents.map(docId => `
                    <button class="btn btn-secondary btn-sm" onclick="app.openPdf('${docId}', '${privateBooking.title}')">
                      📄 Abrir Comprovante PDF
                    </button>
                  `).join("") : ""}
                  ${privateBooking.id === 'flight-tap-ida-1' ? `
                    <button class="btn btn-secondary btn-sm" onclick="app.scrollToImmigrationDocs()">
                      🛂 Seguros de Imigração LIS
                    </button>
                  ` : ""}
                </div>
              ` : ""}
            </div>
          `;
        } else {
          html += `
            <div class="locked-indicator">
              <span>🔒 Detalhes confidenciais (códigos, PINs e vouchers) protegidos no cofre.</span>
            </div>
          `;
        }

        html += `</div>`;
      });

      html += `</div></div>`;
    });

    this.elMainContainer.innerHTML = html;
  }

  _renderFlightsView() {
    const isUnlocked = vault.isUnlocked;
    const privateData = vault.getData();

    let html = `
      <div class="timeline-section-title">
        <span>✈️ Voos & Cartões de Embarque</span>
        ${!isUnlocked ? `<button class="btn btn-primary btn-sm" onclick="app.openUnlockModal()">Destravar Vouchers</button>` : ""}
      </div>
      <div class="events-list">
    `;

    const flights = [
      {
        title: "Voo TAP TP110 • Florianópolis ➔ Lisboa",
        airline: "TAP Air Portugal",
        date: "17 de Outubro de 2026 (00:25 ➔ 15:45)",
        route: "FLN (T1) ➔ LIS (T1)",
        pnr: "X8NDY2",
        checkinUrl: "https://www.flytap.com/pt-br/check-in",
        passengers: "Diego Jacob e Tatiana Jacob",
        docs: ["doc-tap-diego", "doc-tap-tatiana"]
      },
      {
        title: "Voo TAP TP1018 • Lisboa ➔ Madrid",
        airline: "TAP Air Portugal",
        date: "17 de Outubro de 2026 (16:50 ➔ 19:10)",
        route: "LIS (T1) ➔ MAD (T2)",
        pnr: "X8NDY2",
        checkinUrl: "https://www.flytap.com/pt-br/check-in",
        passengers: "Diego Jacob e Tatiana Jacob",
        docs: ["doc-tap-diego", "doc-tap-tatiana"]
      },
      {
        title: "Voo Air Europa UX1663 • Madrid ➔ Genebra",
        airline: "Air Europa",
        date: "18 de Outubro de 2026 (08:00 ➔ 10:00)",
        route: "MAD (T2) ➔ GVA (T1)",
        pnr: "8IAEL8",
        checkinUrl: "https://www.aireuropa.com/br/pt/aea/check-in-online.html",
        passengers: "Diego Jacob, Tatiana Jacob e Fabiana Poli",
        docs: ["doc-aireuropa-diego", "doc-aireuropa-tatiana", "doc-aireuropa-fabiana"]
      },
      {
        title: "Voo Air Europa UX1666 • Genebra ➔ Madrid",
        airline: "Air Europa",
        date: "20 de Outubro de 2026 (18:55 ➔ 21:05)",
        route: "GVA (T1) ➔ MAD (T2)",
        pnr: "8IAEL8",
        checkinUrl: "https://www.aireuropa.com/br/pt/aea/check-in-online.html",
        passengers: "Diego Jacob, Tatiana Jacob e Fabiana Poli",
        docs: ["doc-aireuropa-diego", "doc-aireuropa-tatiana", "doc-aireuropa-fabiana"]
      },
      {
        title: "Voo TAP TP1013 • Madrid ➔ Lisboa",
        airline: "TAP Air Portugal",
        date: "29 de Outubro de 2026 (12:10 ➔ 12:35)",
        route: "MAD (T2) ➔ LIS (T1)",
        pnr: "X8NDY2",
        checkinUrl: "https://www.flytap.com/pt-br/check-in",
        passengers: "Diego Jacob e Tatiana Jacob",
        docs: ["doc-tap-diego", "doc-tap-tatiana"]
      },
      {
        title: "Voo TAP TP109 Direto • Lisboa ➔ Florianópolis",
        airline: "TAP Air Portugal",
        date: "30 de Outubro de 2026 (11:00 ➔ 18:35)",
        route: "LIS (T1) ➔ FLN (T1)",
        pnr: "X8NDY2",
        checkinUrl: "https://www.flytap.com/pt-br/check-in",
        passengers: "Diego Jacob e Tatiana Jacob",
        docs: ["doc-tap-diego", "doc-tap-tatiana"]
      }
    ];

    flights.forEach(f => {
      const isTap = f.airline.includes("TAP");
      html += `
        <div class="event-card">
          <div class="event-card-top">
            <span class="category-tag category-flight">Aéreo</span>
            <span class="event-time">${f.route}</span>
          </div>
          <div class="event-name">${f.title}</div>
          <div class="event-desc">📅 ${f.date} • 👥 ${f.passengers}</div>
          ${isUnlocked ? `
            <div class="secret-badge">
              <div class="secret-grid">
                <div class="secret-item">
                  <span class="secret-label">Localizador da Companhia</span>
                  <span class="secret-value">${f.pnr} <button class="copy-icon-btn" onclick="app.copyToClipboard('${f.pnr}', 'Localizador')">📋</button></span>
                </div>
              </div>
              <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                <a href="${f.checkinUrl}" target="_blank" rel="noopener noreferrer" class="btn ${isTap ? 'btn-checkin-tap' : 'btn-checkin'} btn-sm">
                  🛫 Fazer Check-in ${f.airline} ↗
                </a>
                ${f.docs.map(docId => `
                  <button class="btn btn-secondary btn-sm" onclick="app.openPdf('${docId}', '${f.title}')">
                    📄 Abrir Bilhete PDF
                  </button>
                `).join("")}
              </div>
              ${((f.route && f.route.startsWith("FLN") && f.route.includes("LIS")) || (f.title && f.title.includes("TP110"))) ? `
                <div style="margin-top: 12px; padding: 12px; background: rgba(9, 13, 22, 0.7); border: 1px solid rgba(245, 158, 11, 0.35); border-left: 3px solid var(--accent-amber); border-radius: var(--radius-sm);">
                  <div style="font-weight: 700; color: var(--accent-amber); font-size: 0.85rem; margin-bottom: 4px;">
                    🇵🇹 Desembarque em Lisboa (LIS) • Documentos de Imigração & Seguro Schengen
                  </div>
                  <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">
                    Controle de fronteira e entrada no Espaço Schengen. Apresente os passaportes e as apólices Porto Seguro (€ 30.000 de cobertura médica).
                  </div>
                  <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    <button class="btn btn-secondary btn-sm" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">📄 Bilhete Seguro Diego</button>
                    <button class="btn btn-secondary btn-sm" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">📄 Certificado Schengen Diego</button>
                    <button class="btn btn-secondary btn-sm" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">📄 Bilhete Seguro Tatiana</button>
                    <button class="btn btn-secondary btn-sm" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">📄 Certificado Schengen Tatiana</button>
                    <button class="btn btn-secondary btn-sm" onclick="app.scrollToImmigrationDocs()">⬆️ Ver Card no Topo</button>
                  </div>
                </div>
              ` : ""}
            </div>
          ` : `
            <div class="locked-indicator">
              <span>🔒 Localizador, links de check-in e cartões de embarque protegidos no cofre.</span>
            </div>
            ${f.docs && f.docs.length > 0 ? `
              <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                ${f.docs.map(docId => `
                  <button class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('${docId}', '${f.title}')">
                    📄 Abrir Bilhete PDF <span class="lock-indicator">🔒</span>
                  </button>
                `).join("")}
              </div>
            ` : ""}
            ${((f.route && f.route.startsWith("FLN") && f.route.includes("LIS")) || (f.title && f.title.includes("TP110"))) ? `
              <div style="margin-top: 10px; padding: 10px; background: rgba(9, 13, 22, 0.7); border: 1px solid rgba(245, 158, 11, 0.35); border-left: 3px solid var(--accent-amber); border-radius: var(--radius-sm);">
                <div style="font-weight: 700; color: var(--accent-amber); font-size: 0.85rem; margin-bottom: 4px;">
                  🇵🇹 Desembarque em Lisboa (LIS) • Documentos de Imigração & Seguro Schengen
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
                  <button class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">📄 Bilhete Seguro Diego <span class="lock-indicator">🔒</span></button>
                  <button class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">📄 Certificado Schengen Diego <span class="lock-indicator">🔒</span></button>
                  <button class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">📄 Bilhete Seguro Tatiana <span class="lock-indicator">🔒</span></button>
                  <button class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">📄 Certificado Schengen Tatiana <span class="lock-indicator">🔒</span></button>
                </div>
              </div>
            ` : ""}
          `}
        </div>
      `;
    });

    html += `</div>`;
    this.elMainContainer.innerHTML = html;
  }

  _renderStaysView() {
    const isUnlocked = vault.isUnlocked;

    let html = `
      <div class="timeline-section-title">
        <span>🏨 Hospedagens (6 Estadias na Europa)</span>
        ${!isUnlocked ? `<button class="btn btn-primary btn-sm" onclick="app.openUnlockModal()">Destravar Senhas</button>` : ""}
      </div>
      <div class="events-list">
    `;

    const stays = [
      {
        title: "Hostel Las Rosas • Madrid (1ª Noite)",
        dates: "17 a 18/Outubro/2026",
        address: "Paseo Ginebra 45, San Blas, 28022 Madrid",
        ref: "5098.244.534",
        pin: "8439",
        phone: "+34 689 22 10 67",
        docs: ["doc-hotel-madrid-1"],
        notes: "Pernoite rápida perto do aeroporto de Barajas para o voo matinal da Air Europa."
      },
      {
        title: "Airbnb Saillon • Valais (Suíça - 2 Noites)",
        dates: "18 a 20/Outubro/2026",
        address: "Vers le Scex 3, Saillon, Valais 1913, Suíça",
        ref: "HMSFDZ52SZ",
        host: "Victor",
        phone: "+33 6 12 25 75 63",
        docs: ["doc-airbnb-saillon-res", "doc-airbnb-saillon-anuncio", "doc-pazsalvo-diego-tatiana", "doc-pazsalvo-fabiana"],
        notes: "Vila medieval no Cantão de Valais com águas termais (Les Bains de Saillon). Base estratégica para a visita no Dia 19 ao Templo Divino Daimon em Riddes (~4 km / 7 min). Portar credenciais Paz y Salvo Zeus Daimon. Moeda: CHF."
      },
      {
        title: "Centro Madrid Rio • Madrid (2 Noites)",
        dates: "20 a 22/Outubro/2026",
        address: "Calle Monederos 30, Usera, 28026 Madrid",
        ref: "6716.656.171",
        pin: "3492",
        phone: "+34 657 72 34 54",
        docs: ["doc-hotel-madrid-2"],
        notes: "Hospedagem confortável em Madrid antes da viagem para o congresso em Toledo."
      },
      {
        title: "El Mirador del Valle • Toledo (6 Noites • Congresso)",
        dates: "22 a 28/Outubro/2026",
        address: "Calle de la Retama 17, 45002 Toledo",
        ref: "5889.928.483",
        pin: "8037",
        phone: "+34 687 08 04 76",
        docs: ["doc-hotel-toledo", "doc-convite-diego", "doc-convite-tatiana", "doc-pazsalvo-diego-tatiana", "doc-pazsalvo-fabiana"],
        notes: "Período do Congresso. Vista magnífica de Toledo. Lembrete: Fim do Horário de Verão em 25/Out!"
      },
      {
        title: "Apartamento Centro de Toledo • Toledo (1 Noite)",
        dates: "28 a 29/Outubro/2026",
        address: "4 Callejón Cura, 45003 Toledo, Espanha",
        ref: "6397.678.603",
        pin: "2118",
        phone: "+34 679 19 43 63",
        docs: ["doc-hotel-toledo-2"],
        notes: "Noite extra no centro histórico de Toledo após o congresso (Callejón Cura). Atenção logística para o dia 29: saída cedo de Toledo para o Aeroporto Madrid-Barajas (voo TP1013 às 12:10)."
      },
      {
        title: "Central Lisbon Stay • Lisboa (1 Noite)",
        dates: "29 a 30/Outubro/2026",
        address: "Rua Inácio Pardelhas Sanchez 116B, Campolide, Lisboa",
        ref: "6162.188.474",
        pin: "0098",
        phone: "+351 929 153 578",
        docs: ["doc-hotel-lisboa"],
        notes: "Escala em Lisboa antes do voo direto de retorno ao Brasil."
      }
    ];

    stays.forEach(s => {
      html += `
        <div class="event-card">
          <div class="event-card-top">
            <span class="category-tag category-stay">Hospedagem</span>
            <span class="event-time">${s.dates}</span>
          </div>
          <div class="event-name">${s.title}</div>
          <div class="event-desc">📍 ${s.address}</div>
          ${isUnlocked ? `
            <div class="secret-badge">
              <div class="secret-grid">
                <div class="secret-item">
                  <span class="secret-label">Código de Reserva</span>
                  <span class="secret-value">${s.ref} <button class="copy-icon-btn" onclick="app.copyToClipboard('${s.ref}', 'Reserva')">📋</button></span>
                </div>
                ${s.pin ? `
                  <div class="secret-item">
                    <span class="secret-label">Código PIN de Acesso</span>
                    <span class="secret-value">${s.pin}</span>
                  </div>
                ` : ""}
                <div class="secret-item">
                  <span class="secret-label">Telefone / WhatsApp</span>
                  <span class="secret-value">
                    <a href="https://wa.me/${s.phone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link" title="Abrir conversa no WhatsApp">
                      💬 ${s.phone} ↗
                    </a>
                  </span>
                </div>
              </div>
              <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                <a href="https://wa.me/${s.phone.replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-sm">
                  💬 Conversar no WhatsApp ↗
                </a>
                <a href="tel:${s.phone}" class="btn btn-secondary btn-sm" title="Fazer ligação de voz">
                  📞 Ligar
                </a>
                ${s.docs.map(docId => {
                  const labels = {
                    "doc-hotel-toledo": "🏨 Voucher Hotel Toledo",
                    "doc-hotel-toledo-2": "🏨 Voucher Apto Centro Toledo",
                    "doc-convite-diego": "📄 Carta Convite Diego",
                    "doc-convite-tatiana": "📄 Carta Convite Tatiana",
                    "doc-pazsalvo-diego-tatiana": "📄 Paz y Salvo Diego & Tatiana",
                    "doc-pazsalvo-fabiana": "📄 Paz y Salvo Fabiana",
                    "doc-airbnb-saillon-res": "📄 Recibo Reserva Airbnb",
                    "doc-airbnb-saillon-anuncio": "📄 Detalhes do Anúncio Airbnb"
                  };
                  const label = labels[docId] || "📄 Ver Comprovante de Reserva";
                  return `
                    <button class="btn btn-secondary btn-sm" onclick="app.openPdf('${docId}', '${s.title}')">
                      ${label}
                    </button>
                  `;
                }).join("")}
              </div>
            </div>
          ` : `
            <div class="locked-indicator">
              <span>🔒 Código de reserva, PIN de cofre e vouchers protegidos no cofre.</span>
            </div>
            ${s.docs && s.docs.length > 0 ? `
              <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
                ${s.docs.map(docId => {
                  const labels = {
                    "doc-hotel-toledo": "🏨 Voucher Hotel Toledo",
                    "doc-hotel-toledo-2": "🏨 Voucher Apto Centro Toledo",
                    "doc-convite-diego": "📄 Carta Convite Diego",
                    "doc-convite-tatiana": "📄 Carta Convite Tatiana",
                    "doc-pazsalvo-diego-tatiana": "📄 Paz y Salvo Diego & Tatiana",
                    "doc-pazsalvo-fabiana": "📄 Paz y Salvo Fabiana",
                    "doc-airbnb-saillon-res": "📄 Recibo Reserva Airbnb",
                    "doc-airbnb-saillon-anuncio": "📄 Detalhes do Anúncio Airbnb"
                  };
                  const label = labels[docId] || "📄 Ver Comprovante de Reserva";
                  return `
                    <button class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('${docId}', '${s.title}')">
                      ${label} <span class="lock-indicator">🔒</span>
                    </button>
                  `;
                }).join("")}
              </div>
            ` : ""}
          `}
        </div>
      `;
    });

    html += `</div>`;
    this.elMainContainer.innerHTML = html;
  }

  _renderCarView() {
    const isUnlocked = vault.isUnlocked;
    const privateData = vault.getData();
    const carBooking = isUnlocked && privateData?.bookings ? privateData.bookings.find(b => b.id === 'car-rental-genebra') : null;

    this.elMainContainer.innerHTML = `
      <div class="timeline-section-title">
        <span>🇨🇭 Suíça & Aluguel de Carro (Valais)</span>
        ${!isUnlocked ? `<button class="btn btn-primary btn-sm" onclick="app.openUnlockModal()">Destravar Documentos</button>` : ""}
      </div>

      <!-- Card da Reserva Confirmada de Carro -->
      <div class="event-card" style="border-left: 4px solid var(--accent-emerald); margin-bottom: 16px;">
        <div class="event-card-top">
          <span class="category-tag category-car" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald); border: 1px solid rgba(16, 185, 129, 0.3);">🚗 Reserva Confirmada</span>
          <span class="event-time">18/Out 11:00 ➔ 20/Out 11:00</span>
        </div>
        <div class="event-name">Skoda Fabia ou semelhante • Câmbio Automático</div>
        <div class="event-desc">📍 Europcar / Unirent (Arrivals Hall - Setor Suíço • Genève Airport, 1215)</div>

        ${isUnlocked ? `
          <div class="secret-badge" style="margin-top: 12px;">
            <div class="secret-grid">
              <div class="secret-item">
                <span class="secret-label">Ref. Argus Car Hire</span>
                <span class="secret-value">${carBooking?.bookingRef || 'CH279343390'} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${carBooking?.bookingRef || 'CH279343390'}', 'Ref. Argus')">📋</button></span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Nº Confirmação Fornecedor</span>
                <span class="secret-value">${carBooking?.confirmationNumber || '1208217510'} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${carBooking?.confirmationNumber || '1208217510'}', 'Nº Confirmação')">📋</button></span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Condutor Principal</span>
                <span class="secret-value">${carBooking?.driver || 'Diego Jacob Fernandes Leite'}</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Telefone do Balcão GVA</span>
                <span class="secret-value">
                  <a href="tel:+41227178110" class="whatsapp-badge-link" title="Ligar para o balcão">
                    📞 022 717 81 10 (+41)
                  </a>
                </span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Caução Retida no Cartão</span>
                <span class="secret-value" style="color: var(--accent-amber);">CHF 350,00 (Bloqueio temporário)</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Franquia Máxima de Sinistro</span>
                <span class="secret-value" style="color: var(--text-dim); font-size: 0.85rem;">CHF 2.500,00 (Danos/Roubo)</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Pagamento da Reserva</span>
                <span class="secret-value" style="color: var(--accent-emerald);">USD 98.22 Pago Online (CHF 0,00 no balcão)</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Combustível & Km</span>
                <span class="secret-value">Depósito Cheio (Full to Full) • Km Ilimitada</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Garantia de Combustível</span>
                <span class="secret-value" style="color: var(--text-dim); font-size: 0.85rem;">Depósito temporário no balcão (~CHF 80-100)</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Equipamento de Inverno</span>
                <span class="secret-value">Conjunto de Inverno Incluído (CHF 0,00)</span>
              </div>
            </div>

            <div style="margin-top: 12px; padding: 12px; background: rgba(0,0,0,0.25); border-radius: var(--radius-sm); font-size: 0.82rem; line-height: 1.6; color: var(--text-muted); border: 1px solid rgba(255,255,255,0.06);">
              <strong style="color: var(--text-main);">📋 Requisitos Obrigatórios para Retirada no Balcão:</strong><br>
              1. 💳 <strong>Cartão de crédito físico</strong> em nome do condutor principal (<strong>Diego Jacob Fernandes Leite</strong>, sem abreviações) com limite para a caução de <strong>CHF 350,00</strong> (+ margem para garantia de combustível) e com a <strong>senha PIN</strong> do chip.<br>
              2. 🪪 <strong>CNH física válida</strong> do Diego (+ Permissão Internacional para Dirigir recomendada).<br>
              3. 🛂 <strong>Passaporte brasileiro</strong> (GO506551).<br>
              4. 📄 <strong>Voucher da reserva</strong> (Ref. Argus: CH279343390 / Conf: 1208217510).<br>
              <span style="font-size: 0.76rem; color: var(--text-dim);">ℹ️ <em>Nota sobre a Franquia: O bloqueio de caução no balcão é de apenas <strong>CHF 350,00</strong>. O valor de CHF 2.500,00 é o limite máximo de responsabilidade (franquia do seguro CDW/Roubo) caso ocorra acidente ou avaria não coberta.</em></span>
            </div>

            <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-primary btn-sm doc-action-btn" onclick="app.openPdf('doc-carro-suica', 'Voucher Aluguel de Carro - Skoda Fabia (Argus / Unirent)')">
                📄 Ver Voucher da Reserva (PDF)
              </button>
              <a href="tel:+41227178110" class="btn btn-secondary btn-sm" title="Ligar para o balcão da locadora">
                📞 Ligar para Balcão (022 717 81 10)
              </a>
            </div>
          </div>
        ` : `
          <div class="locked-indicator" style="margin-top: 12px;">
            <span>🔒 Código de reserva, confirmação, telefone do balcão e voucher PDF protegidos no cofre.</span>
          </div>
          <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" class="btn btn-doc-locked btn-sm doc-action-btn" onclick="app.openPdf('doc-carro-suica', 'Voucher Aluguel de Carro - Skoda Fabia (Argus / Unirent)')">
              📄 Ver Voucher da Reserva (PDF) <span class="lock-indicator">🔒</span>
            </button>
          </div>
        `}
      </div>

      <div class="event-card" style="border-left: 4px solid var(--accent-amber);">
        <div class="event-name">⚠️ ALERTA OPERACIONAL: Setor Suíço do Aeroporto de Genebra</div>
        <p class="event-desc" style="color:var(--text-main); margin-bottom: 12px;">
          O Aeroporto de Genebra (GVA) é dividido entre os setores <strong>Suíço (Secteur Suisse)</strong> e <strong>Francês (Secteur France)</strong>.
        </p>
        <ul style="padding-left: 20px; font-size: 0.9rem; color: var(--text-muted); line-height: 1.6;">
          <li><strong>Obrigatoriedade:</strong> A reserva e a retirada do veículo devem ser efetuadas no <strong>Setor Suíço</strong>.</li>
          <li><strong>Vignette de Pedágio Incluída:</strong> Carros locados no lado suíço já possuem a <em>Vignette Rodoviária</em> obrigatória fixada no para-brisa (economia de CHF 40).</li>
          <li><strong>Risco de Multa:</strong> Trafegar nas rodovias A1 e A9 sem a Vignette acarreta multa de <strong>CHF 200 + taxa</strong> pela polícia rodoviária suíça.</li>
          <li><strong>Devolução:</strong> Certifique-se de abastecer e devolver no mesmo Setor Suíço antes das 16:30 do dia 20/Out.</li>
        </ul>
      </div>

      <div class="event-card" style="margin-top: 16px;">
        <div class="event-name">🗺️ Rota Principal: Aeroporto de Genebra (GVA) ➔ Saillon (Valais)</div>
        <div class="event-desc">Distância: 145 km • Tempo médio: 1h35min via Autoestradas A1 & A9</div>
        <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.88rem; line-height: 1.6;">
          <strong>Itinerário Recomendado:</strong><br>
          1. Saída do GVA pegando a Autoestrada <strong>A1</strong> sentido Lausanne.<br>
          2. Na bifurcação em Lausanne, seguir pela <strong>A9</strong> sentido Martigny / Sion.<br>
          3. Seguir pelo belíssimo Vale do Ródano cercado pelas montanhas até a <strong>Saída 24 (Riddes / Saillon)</strong>.<br>
          4. Atravessar a ponte sobre o rio Ródano e seguir as placas até o vilarejo de Saillon.
        </div>
      </div>

      <!-- Roteiro em Valais: Saillon ➔ Riddes (Templo Divino Daimon) & Arredores -->
      <div class="event-card" style="margin-top: 16px; border-left: 4px solid var(--accent-emerald);">
        <div class="event-name">🏛️ Roteiro em Valais: Saillon ➔ Riddes (Templo Divino Daimon) & Arredores</div>
        <div class="event-desc">Visita oficial no Dia 19/10 e passeios pelas joias alpinas do Cantão de Valais.</div>
        
        <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.88rem; line-height: 1.6; margin-bottom: 12px;">
          <strong>📍 Rota Saillon ➔ Riddes (Templo Divino Daimon):</strong><br>
          • <strong>Distância & Tempo:</strong> Apenas <strong>~4 km</strong> (cerca de 6 a 8 minutos de carro).<br>
          • <strong>Trajeto:</strong> Saillon e Riddes são cidades vizinhas no Cantão de Valais, separadas apenas pelo Rio Ródano (Rhône). Siga pela <em>Route de Saillon</em> e cruze a <em>Pont de Riddes</em> diretamente até o centro de Riddes.<br>
          • <strong>Confirmações & Credenciais:</strong> Portar os documentos eclesiais de Paz y Salvo emitidos pelo Lumisial Zeus Daimon (Mem 207/2026 de Diego & Tatiana e Mem 209/2026 de Fabiana).<br>
          • <strong>Recomendações Litúrgicas:</strong> Trajes litúrgicos / vestes sacerdotais e de Isis, pontualidade suíça e respeito às diretrizes do templo irmão em Valais.
        </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px;">
          <a href="https://www.google.com/maps/dir/?api=1&origin=Vers+le+Scex+3,+Saillon,+Switzerland&destination=Riddes,+Switzerland&travelmode=driving" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px;">
            🗺️ Rota Saillon ➔ Riddes (Google Maps) ↗
          </a>
          <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
            📄 Paz y Salvo Diego & Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
          </button>
          <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-fabiana', 'Paz y Salvo - Fabiana Nunes Poli')">
            📄 Paz y Salvo Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
          </button>
        </div>

        <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.88rem; line-height: 1.6;">
          <strong>🏔️ Arredores em Valais Recomendados:</strong><br>
          • <strong>Les Bains de Saillon (~1 km):</strong> Famoso centro termal alpino com piscinas térmicas quentes ao ar livre (32°C a 34°C) com vista panorâmica para os vinhedos de Saillon.<br>
          • <strong>Martigny (~15 km a oeste via A9 ou Route Cantonale):</strong> Cidade histórica romana, sede da prestigiada Fundação Pierre Gianadda e do Castelo La Bâtiaz.<br>
          • <strong>Sion (~18 km a leste via A9):</strong> Histórica capital de Valais, coroada pelas colinas fortificadas dos castelos de Valère e Tourbillon.
        </div>
      </div>

      <!-- Recomendações Práticas na Suíça -->
      <div class="event-card" style="margin-top: 16px; border-left: 4px solid var(--accent-sky);">
        <div class="event-name">🇨🇭 Recomendações Práticas de Condução & Trânsito na Suíça</div>
        <div class="event-desc">Normas cantonais e de trânsito essenciais para dirigir com segurança e sem infrações.</div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; margin-top: 10px;">
          <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.5;">
            <strong style="color:var(--accent-amber);">⚡ Limites Rigorosos de Velocidade</strong><br>
            • <strong>50 km/h:</strong> Zonas urbanas e perímetros de vilarejos (tolerância zero, radares fixos frequentes).<br>
            • <strong>80 km/h:</strong> Estradas cantonais e secundárias fora de localidades.<br>
            • <strong>100 km/h:</strong> Semiautoestradas expressas.<br>
            • <strong>120 km/h:</strong> Autoestradas federais (A1 / A9). Multas suíças são rigorosas e de alto valor.
          </div>

          <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.5;">
            <strong style="color:var(--accent-sky);">💡 Faróis Acesos 24h por Lei (Tagfahrlicht)</strong><br>
            Na Suíça, é <strong>obrigatório por lei manter os faróis baixos ou DRL acesos o tempo todo</strong>, inclusive em pleno dia com sol aberto. Conduzir com faróis apagados é passível de autuação rodoviária.
          </div>

          <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.5;">
            <strong style="color:var(--accent-emerald);">🅿️ Estacionamento: Disco Azul & Parquímetros</strong><br>
            • <strong>Zona Azul (Zone Bleue):</strong> Estacionamento gratuito por tempo limitado (1h a 1h30), exigindo o uso obrigatório do <em>disco azul de estacionamento</em> visível no para-brisa.<br>
            • <strong>Zonas Pagas:</strong> Parquímetro em francos suíços (CHF) ou pagamento por aplicativo móvel (<em>EasyPark / Parkingpay</em>).
          </div>

          <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; line-height: 1.5;">
            <strong style="color:var(--text-main);">🍂 Clima de Montanha no Outono</strong><br>
            Em outubro no Cantão de Valais, as temperaturas variam entre 4°C e 15°C, com possibilidade de neblina matinal no Vale do Ródano e folhas úmidas no asfalto. Recomenda-se manter casacos térmicos acessíveis no carro.
          </div>
        </div>
      </div>
    `;
  }

  _renderCongressView() {
    const isUnlocked = vault.isUnlocked;
    const privateData = vault.getData();
    const tDiego = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "diego") : null;
    const tTatiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "tatiana") : null;
    const tFabiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "fabiana") : null;

    this.elMainContainer.innerHTML = `
      <div class="timeline-section-title">
        <span>🎓 Congresso Internacional de Gnosis • Toledo</span>
        ${!isUnlocked ? `<button class="btn btn-primary btn-sm" onclick="app.openUnlockModal()">Destravar Documentos</button>` : ""}
      </div>

      <!-- Card de Documentos Oficiais & Credenciamento -->
      <div class="event-card" style="border-left: 4px solid var(--accent-emerald);">
        <div class="event-name">📜 Documentos Oficiais & Credenciamento do Congresso</div>
        <div class="event-desc">Cartas de convite internacional e comprovantes eclesiais de Paz y Salvo para os congressistas.</div>

        <div class="secret-badge" style="margin-top: 12px;">
          <div style="font-size: 0.84rem; color: var(--text-muted); margin-bottom: 12px; line-height: 1.5;">
            🏛️ <strong>Evento Oficial:</strong> Congreso Gnóstico Internacional – España 2026 (23 a 27 de Outubro)<br>
            📍 <strong>Sede Oficial:</strong> Palacio de Congresos “El Greco”, Toledo (Espanha)<br>
            🕊️ <strong>Delegação:</strong> Lumisial Zeus Daimon (São Pedro de Alcântara / SC, Brasil) • Igreja Gnóstica (RER 013873)
          </div>

          <div class="secret-grid" style="margin-bottom: 12px;">
            ${isUnlocked && tDiego ? `
              <div class="secret-item">
                <span class="secret-label">Diego Jacob (Sacerdote)</span>
                <span class="secret-value">Passaporte NOVO: ${tDiego.passport} (antigo: ${tDiego.oldPassport || 'FR302881'}) <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tDiego.passport}', 'Passaporte Diego')">📋</button> <button type="button" class="copy-icon-btn" title="Copiar passaporte antigo" onclick="app.copyToClipboard('${tDiego.oldPassport || 'FR302881'}', 'Passaporte Antigo Diego')">📋 (antigo)</button></span>
              </div>
            ` : `
              <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                <span class="secret-label">Diego Jacob (Sacerdote)</span>
                <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
              </div>
            `}
            ${isUnlocked && tTatiana ? `
              <div class="secret-item">
                <span class="secret-label">Tatiana Araújo (Isis)</span>
                <span class="secret-value">Passaporte: ${tTatiana.passport} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tTatiana.passport}', 'Passaporte Tatiana')">📋</button></span>
              </div>
            ` : `
              <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                <span class="secret-label">Tatiana Araújo (Isis)</span>
                <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
              </div>
            `}
            ${isUnlocked && tFabiana ? `
              <div class="secret-item">
                <span class="secret-label">Fabiana Nunes Poli (Isis)</span>
                <span class="secret-value">Passaporte: ${tFabiana.passport} <button type="button" class="copy-icon-btn" onclick="app.copyToClipboard('${tFabiana.passport}', 'Passaporte Fabiana')">📋</button></span>
              </div>
            ` : `
              <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                <span class="secret-label">Fabiana Nunes Poli (Isis)</span>
                <span class="secret-value locked-val text-muted"><span class="locked-asterisks">••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
              </div>
            `}
            <div class="secret-item">
              <span class="secret-label">Credenciais Paz y Salvo</span>
              <span class="secret-value">${isUnlocked && tFabiana?.credencial ? `Mem 207/2026 & ${tFabiana.credencial}` : `VIC 207/2026 & VIC 209/2026`}</span>
            </div>
          </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;">
            <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-convite-diego', 'Carta de Invitación - Diego Jacob Fernandes Leite')">
              📄 Carta Convite Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-convite-tatiana', 'Carta de Invitación - Tatiana Araújo de Sousa Jacob')">
              📄 Carta Convite Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-diego-tatiana', 'Paz y Salvo - Diego Jacob & Tatiana Araújo')">
              📄 Paz y Salvo Diego & Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-pazsalvo-fabiana', 'Paz y Salvo - Fabiana Nunes Poli')">
              📄 Paz y Salvo Fabiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-hotel-toledo', 'El Mirador del Valle - Reserva Hotel Toledo')">
              🏨 Voucher Hotel Toledo ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
          </div>
        </div>
      </div>

      <!-- Card de Informações da Cidade & Hospedagem -->
      <div class="event-card">
        <div class="event-name">Toledo • Cidade Histórica & Congresso</div>
        <div class="event-desc">Período: 22 a 28 de Outubro de 2026 (6 noites)</div>
        <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.88rem; line-height: 1.6; margin-bottom: 12px;">
          🏨 <strong>Hospedagem Oficial:</strong> El Mirador del Valle (Calle de la Retama 17, Toledo)<br>
          📞 <strong>Telefone:</strong> +34 687 08 04 76<br>
          📍 <strong>Localização:</strong> Ponto mais nobre e panorâmico de Toledo, com vista panorâmica do Alcázar e da Catedral.
        </div>
        <div class="event-card" style="border: 1px solid var(--accent-rose); background: rgba(239, 68, 68, 0.05);">
          <strong style="color:var(--accent-rose);">⚠️ ATENÇÃO: Mudança de Horário em 25/Outubro</strong><br>
          <span style="font-size: 0.85rem; color: var(--text-muted);">
            Na madrugada de domingo 25/10/2026, às 03:00, os relógios na Espanha e na Europa atrasam 1 hora (CEST UTC+2 ➔ CET UTC+1). A programação do congresso e os despertadores devem considerar essa transição.
          </span>
        </div>
      </div>
    `;
  }

  _renderEmergencyView() {
    const isUnlocked = vault.isUnlocked;
    const privateData = vault.getData();
    const tDiego = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "diego") : null;
    const tTatiana = isUnlocked && privateData?.travelers ? privateData.travelers.find(t => t.id === "tatiana") : null;
    const pSeguro = isUnlocked && privateData?.emergencyContacts?.portoSeguro ? privateData.emergencyContacts.portoSeguro : null;

    this.elMainContainer.innerHTML = `
      <div class="timeline-section-title">
        <span>🆘 Contatos de Emergência & Seguro Viagem</span>
        ${!isUnlocked ? `<button class="btn btn-primary btn-sm" onclick="app.openUnlockModal()">Destravar Apólices</button>` : ""}
      </div>
      <div class="event-card" style="border-left: 4px solid var(--accent-rose);">
        <div class="event-name">🛡️ Porto Seguro Assistência Internacional 24h</div>
        <div class="event-desc">Cobertura Médica/Hospitalar no Espaço Schengen, Despesas Farmacêuticas e Bagagem.</div>
        <div class="secret-badge">
          <div class="secret-grid">
            <div class="secret-item">
              <span class="secret-label">Central Internacional (Brasil)</span>
              <span class="secret-value"><a href="tel:+551133663330" style="color:var(--accent-amber);">+55 11 3366-3330</a></span>
            </div>
            <div class="secret-item">
              <span class="secret-label">WhatsApp Oficial 24h</span>
              <span class="secret-value"><a href="https://wa.me/551130039303" target="_blank" style="color:var(--accent-emerald);">+55 11 3003-9303</a></span>
            </div>
            <div class="secret-item">
              <span class="secret-label">Ligação Gratuita (Espanha)</span>
              <span class="secret-value"><a href="tel:900802811" style="color:var(--accent-amber);">900 802 811</a></span>
            </div>
            <div class="secret-item">
              <span class="secret-label">Ligação Gratuita (Portugal)</span>
              <span class="secret-value"><a href="tel:800814624" style="color:var(--accent-amber);">800 814 624</a></span>
            </div>
            ${isUnlocked ? `
              <div class="secret-item">
                <span class="secret-label">Diego Jacob Fernandes Leite</span>
                <span class="secret-value">Apólice: ${tDiego?.apolice || pSeguro?.apóliceDiego || ""} ${tDiego?.certSchengen ? `(Cert: ${tDiego.certSchengen})` : ""}</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Tatiana Araujo de Sousa Jacob</span>
                <span class="secret-value">Apólice: ${tTatiana?.apolice || pSeguro?.apóliceTatiana || ""} ${tTatiana?.certSchengen ? `(Cert: ${tTatiana.certSchengen})` : ""}</span>
              </div>
            ` : `
              <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                <span class="secret-label">Diego Jacob Fernandes Leite</span>
                <span class="secret-value locked-val text-muted"><span class="locked-asterisks">•••••••••••••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
              </div>
              <div class="secret-item" onclick="app.openUnlockModal()" style="cursor:pointer;" title="Toque para destravar">
                <span class="secret-label">Tatiana Araujo de Sousa Jacob</span>
                <span class="secret-value locked-val text-muted"><span class="locked-asterisks">•••••••••••••••••••••</span> <span class="locked-tag-inline">🔒 Bloqueado</span></span>
              </div>
            `}
          </div>
          <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">
              📄 Bilhete Seguro Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">
              📄 Certificado Schengen Diego ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">
              📄 Bilhete Seguro Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-doc-locked'} btn-sm doc-action-btn" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">
              📄 Certificado Schengen Tatiana ${isUnlocked ? '' : '<span class="lock-indicator">🔒</span>'}
            </button>
          </div>
          ${!isUnlocked ? `
            <div class="locked-indicator" style="margin-top: 8px;">
              <span>🔒 Apólices e dados protegidos com criptografia AES-256-GCM. Toque em qualquer documento acima para destravar e visualizar.</span>
            </div>
          ` : ""}
        </div>
      </div>

      <div class="event-card" style="margin-top: 16px;">
        <div class="event-name">🚨 Telefones de Emergência na Europa</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 10px;">
          <div style="background:var(--bg-main); padding: 10px; border-radius: var(--radius-sm);">
            <span style="font-size: 0.72rem; color:var(--text-dim); text-transform:uppercase;">União Europeia (Espanha e Portugal)</span><br>
            <strong style="font-size: 1.1rem; color:var(--accent-rose);"><a href="tel:112">112</a></strong> (Geral/Polícia/Ambulância)
          </div>
          <div style="background:var(--bg-main); padding: 10px; border-radius: var(--radius-sm);">
            <span style="font-size: 0.72rem; color:var(--text-dim); text-transform:uppercase;">Suíça • Médica</span><br>
            <strong style="font-size: 1.1rem; color:var(--accent-rose);"><a href="tel:144">144</a></strong> (Ambulância)
          </div>
          <div style="background:var(--bg-main); padding: 10px; border-radius: var(--radius-sm);">
            <span style="font-size: 0.72rem; color:var(--text-dim); text-transform:uppercase;">Suíça • Polícia</span><br>
            <strong style="font-size: 1.1rem; color:var(--accent-amber);"><a href="tel:117">117</a></strong> (Polícia Suíça)
          </div>
        </div>
      </div>

      <div class="event-card" style="margin-top: 16px;">
        <div class="event-name">🏛️ Plantão Consular Brasileiro</div>
        <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.8; margin-top: 8px;">
          • <strong>Espanha (Madrid):</strong> <a href="https://wa.me/34677544004" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link">💬 +34 677 544 004 ↗</a> <span style="font-size:0.75rem; color:var(--text-dim);">(Calle de Fernando El Santo 6)</span><br>
          • <strong>Portugal (Lisboa):</strong> <a href="https://wa.me/351962520581" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link">💬 +351 962 520 581 ↗</a> <span style="font-size:0.75rem; color:var(--text-dim);">(Praça Luís de Camões 22)</span><br>
          • <strong>Suíça (Genebra):</strong> <a href="https://wa.me/41793504955" target="_blank" rel="noopener noreferrer" class="whatsapp-badge-link">💬 +41 79 350 49 55 ↗</a> <span style="font-size:0.75rem; color:var(--text-dim);">(Rue de Lausanne 45)</span>
        </div>
      </div>
    `;
  }

  async prepareOffline() {
    this._showToast("📦 Baixando e verificando todos os arquivos para o modo avião...");
    try {
      const manifestResp = await fetch("vault/asset-manifest.json");
      if (!manifestResp.ok) throw new Error("Erro ao ler manifesto.");
      const manifest = await manifestResp.json();

      let downloaded = 0;
      for (const item of manifest) {
        await fetch(`vault/assets/${item.id}.enc`);
        downloaded++;
      }

      await fetch("vault/key-envelope.json");
      await fetch("vault/index.enc");
      await fetch("data/public-timeline.json");

      this._showToast(`✓ Sucesso! ${downloaded}/${manifest.length} documentos salvos para uso offline.`);
    } catch (err) {
      this._showToast("Falha ao preparar offline: " + err.message);
    }
  }
}

// Inicializar aplicativo no escopo global
window.vault = vault;
window.app = new EuropaApp();
