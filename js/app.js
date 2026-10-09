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
    navigator.clipboard.writeText(text).then(() => {
      this._showToast(`✓ ${label} copiado!`);
    }).catch(() => {
      this._showToast(`Falha ao copiar.`);
    });
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
              <strong>Apresentação Obrigatória na Imigração:</strong> Para ingressar em Portugal e no Espaço Schengen, apresente os passaportes brasileiros e os certificados de seguro viagem com cobertura médica/hospitalar mínima de <strong>€ 30.000</strong> (Porto Seguro).
            </p>

            <div class="immigration-travelers-grid">
              <!-- Diego Jacob -->
              <div class="traveler-doc-box">
                <div class="traveler-header">
                  <div class="traveler-avatar">👤</div>
                  <div>
                    <strong class="traveler-name">Diego Jacob Fernandes Leite</strong>
                    <span class="traveler-role">Titular • Voo TAP TP110</span>
                  </div>
                </div>
                <div class="policy-details">
                  <div class="policy-row">
                    <span class="policy-label">Apólice Porto Seguro:</span>
                    <span class="policy-val">16023-0003-69-260122474 <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('16023-0003-69-260122474', 'Apólice Diego')">📋</button></span>
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Certificado Schengen:</span>
                    <span class="policy-val">32572804832 <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('32572804832', 'Certificado Diego')">📋</button></span>
                  </div>
                </div>
                <div class="traveler-actions">
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">
                    📄 Bilhete Seguro Diego
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">
                    📄 Certificado Schengen Diego
                  </button>
                </div>
              </div>

              <!-- Tatiana Jacob -->
              <div class="traveler-doc-box">
                <div class="traveler-header">
                  <div class="traveler-avatar">👤</div>
                  <div>
                    <strong class="traveler-name">Tatiana Araujo de Sousa Jacob</strong>
                    <span class="traveler-role">Esposa / Segurada • Voo TAP TP110</span>
                  </div>
                </div>
                <div class="policy-details">
                  <div class="policy-row">
                    <span class="policy-label">Apólice Porto Seguro:</span>
                    <span class="policy-val">16023-0003-69-260122473 <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('16023-0003-69-260122473', 'Apólice Tatiana')">📋</button></span>
                  </div>
                  <div class="policy-row">
                    <span class="policy-label">Certificado Schengen:</span>
                    <span class="policy-val">29340388828 <button type="button" class="copy-icon-btn" onclick="event.stopPropagation(); app.copyToClipboard('29340388828', 'Certificado Tatiana')">📋</button></span>
                  </div>
                </div>
                <div class="traveler-actions">
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">
                    📄 Bilhete Seguro Tatiana
                  </button>
                  <button type="button" class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm doc-action-btn" onclick="event.stopPropagation(); app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">
                    📄 Certificado Schengen Tatiana
                  </button>
                </div>
              </div>
            </div>

            ${!isUnlocked ? `
              <div class="immigration-lock-hint" onclick="event.stopPropagation(); app.openUnlockModal()">
                <span>🔒 PDFs protegidos com criptografia AES-256-GCM. Toque em qualquer botão ou <strong>aqui para destravar com a senha mestre (ti8mao)</strong>.</span>
              </div>
            ` : `
              <div class="immigration-unlocked-hint">
                <span>✓ Apólices e certificados decifrados em memória (RAM) • Toque em qualquer botão para visualização imediata ou download offline.</span>
              </div>
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
      targetTime = `${this.simulatedDate}T12:00:00`;
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

    if (evt.documents && evt.documents.length > 0) {
      actionButtonsHtml += `
        <button class="btn btn-secondary btn-sm" onclick="app.openPdf('${evt.documents[0]}', '${evt.title}')">
          📄 Ver Voucher PDF
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
        title: "Madrid Noite",
        tag: "Madrid",
        city: "Villa Potasa"
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
                <div class="secret-item">
                  <span class="secret-label">Diego Jacob (Titular)</span>
                  <span class="secret-value">Apólice: 16023-0003-69-260122474 (Cert: 32572804832)</span>
                </div>
                <div class="secret-item">
                  <span class="secret-label">Tatiana Jacob (Esposa)</span>
                  <span class="secret-value">Apólice: 16023-0003-69-260122473 (Cert: 29340388828)</span>
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">
                  📄 Bilhete Seguro Diego
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">
                  📄 Certificado Schengen Diego
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">
                  📄 Bilhete Seguro Tatiana
                </button>
                <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">
                  📄 Certificado Schengen Tatiana
                </button>
                <button class="btn btn-secondary btn-sm" onclick="app.scrollToImmigrationDocs()">
                  ⬆️ Ver Card de Imigração no Topo
                </button>
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
            ${((f.route && f.route.startsWith("FLN") && f.route.includes("LIS")) || (f.title && f.title.includes("TP110"))) ? `
              <div style="margin-top: 10px; padding: 10px; background: rgba(9, 13, 22, 0.7); border: 1px solid rgba(245, 158, 11, 0.35); border-left: 3px solid var(--accent-amber); border-radius: var(--radius-sm);">
                <div style="font-weight: 700; color: var(--accent-amber); font-size: 0.85rem; margin-bottom: 4px;">
                  🇵🇹 Desembarque em Lisboa (LIS) • Documentos de Imigração & Seguro Schengen
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px;">
                  <button class="btn btn-outline-amber btn-sm" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">📄 Bilhete Seguro Diego</button>
                  <button class="btn btn-outline-amber btn-sm" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">📄 Certificado Schengen Diego</button>
                  <button class="btn btn-outline-amber btn-sm" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">📄 Bilhete Seguro Tatiana</button>
                  <button class="btn btn-outline-amber btn-sm" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">📄 Certificado Schengen Tatiana</button>
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
        docs: ["doc-airbnb-saillon-res", "doc-airbnb-saillon-anuncio"],
        notes: "Vila medieval suíça com termas famosas (Les Bains de Saillon). Moeda: CHF."
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
        docs: ["doc-hotel-toledo"],
        notes: "Período do Congresso. Vista magnífica de Toledo. Lembrete: Fim do Horário de Verão em 25/Out!"
      },
      {
        title: "Villa Potasa 19 • Madrid (1 Noite)",
        dates: "28 a 29/Outubro/2026",
        address: "Calle Potasa 19 baixo 2, Villaverde, 28021 Madrid",
        ref: "5567.803.610",
        pin: "5069",
        phone: "+34 654 10 39 38",
        docs: ["doc-hotel-madrid-3"],
        notes: "Última noite na Espanha antes do voo matinal para Lisboa."
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
                ${s.docs.map(docId => `
                  <button class="btn btn-secondary btn-sm" onclick="app.openPdf('${docId}', '${s.title}')">
                    📄 Ver Comprovante de Reserva
                  </button>
                `).join("")}
              </div>
            </div>
          ` : `
            <div class="locked-indicator">
              <span>🔒 Código de reserva, PIN de cofre e vouchers protegidos no cofre.</span>
            </div>
          `}
        </div>
      `;
    });

    html += `</div>`;
    this.elMainContainer.innerHTML = html;
  }

  _renderCarView() {
    this.elMainContainer.innerHTML = `
      <div class="timeline-section-title">
        <span>🚗 Aluguel de Carro & Rotas na Suíça</span>
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
        <div class="event-name">🗺️ Rota Aeroporto de Genebra (GVA) ➔ Saillon (Valais)</div>
        <div class="event-desc">Distância: 145 km • Tempo médio: 1h35min</div>
        <div style="background: var(--bg-main); padding: 12px; border-radius: var(--radius-sm); font-size: 0.88rem; line-height: 1.6;">
          <strong>Itinerário Recomendado:</strong><br>
          1. Saída do GVA pegando a Autoestrada <strong>A1</strong> sentido Lausanne.<br>
          2. Na bifurcação em Lausanne, seguir pela <strong>A9</strong> sentido Martigny / Sion.<br>
          3. Seguir pelo belíssimo Vale do Ródano cercado pelas montanhas até a <strong>Saída 24 (Riddes / Saillon)</strong>.<br>
          4. Atravessar a ponte sobre o rio Ródano e seguir as placas até o vilarejo de Saillon.
        </div>
      </div>
    `;
  }

  _renderCongressView() {
    this.elMainContainer.innerHTML = `
      <div class="timeline-section-title">
        <span>🎓 Congresso Acadêmico em Toledo</span>
      </div>
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
                <span class="secret-value">Apólice: 16023-0003-69-260122474 (Cert: 32572804832)</span>
              </div>
              <div class="secret-item">
                <span class="secret-label">Tatiana Araujo de Sousa Jacob</span>
                <span class="secret-value">Apólice: 16023-0003-69-260122473 (Cert: 29340388828)</span>
              </div>
            ` : ""}
          </div>
          <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-diego-bilhete', 'Bilhete de Seguro - Diego Jacob Fernandes Leite')">
              📄 Bilhete Seguro Diego
            </button>
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-diego-cert', 'Certificado Schengen - Diego Jacob Fernandes Leite')">
              📄 Certificado Schengen Diego
            </button>
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-tatiana-bilhete', 'Bilhete de Seguro - Tatiana Araujo de Sousa Jacob')">
              📄 Bilhete Seguro Tatiana
            </button>
            <button class="btn ${isUnlocked ? 'btn-secondary' : 'btn-outline-amber'} btn-sm" onclick="app.openPdf('doc-seguro-tatiana-cert', 'Certificado Schengen - Tatiana Araujo de Sousa Jacob')">
              📄 Certificado Schengen Tatiana
            </button>
          </div>
          ${!isUnlocked ? `
            <div class="locked-indicator" style="margin-top: 8px;">
              <span>🔒 Apólices protegidas com criptografia AES-256-GCM. Toque em qualquer documento acima para destravar e visualizar.</span>
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
