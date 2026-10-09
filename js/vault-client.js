/**
 * Europa 2026 - Vault Client Module
 * =================================
 * Gerenciador de sessão em memória volátil, auto-lock,
 * descriptografia de dados confidenciais e ciclo de vida de PDFs.
 */

import { unwrapDek, decryptIndex, decryptPdf, VaultCryptoError } from "./crypto-format.js";

class VaultClient {
  constructor() {
    this.sessionDek = null;
    this.vaultId = null;
    this.privateData = null;
    this.isUnlocked = false;
    this.activeBlobUrls = new Set();
    this.inactivityTimer = null;
    this.inactivityTimeoutMs = 15 * 60 * 1000; // 15 minutos

    this._setupSecurityListeners();
  }

  /**
   * Monitora perda de visibilidade da aba e inatividade
   */
  _setupSecurityListeners() {
    // Trancar automaticamente quando o usuário minimiza o navegador ou troca de aba
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.isUnlocked) {
        console.warn("🔒 Aba oculta: trancando cofre de segurança por precaução.");
        this.lock();
      }
    });

    // Revogar todos os Blobs no descarregamento da página
    window.addEventListener("pagehide", () => {
      this._revokeAllBlobs();
    });

    // Resetar timer de inatividade com toques e cliques
    const resetTimer = () => {
      if (!this.isUnlocked) return;
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = setTimeout(() => {
        console.warn("⏱️ Tempo limite de inatividade atingido. Trancando cofre.");
        this.lock();
      }, this.inactivityTimeoutMs);
    };

    window.addEventListener("touchstart", resetTimer, { passive: true });
    window.addEventListener("click", resetTimer, { passive: true });
    window.addEventListener("keydown", resetTimer, { passive: true });
  }

  /**
   * Destrava o cofre com a senha mestre
   */
  async unlock(passphrase) {
    if (this.isUnlocked) return this.privateData;

    try {
      // 1. Carregar o envelope de chave
      const envResp = await fetch("vault/key-envelope.json", { cache: "no-store" });
      if (!envResp.ok) throw new Error("Não foi possível carregar o envelope de chave pública.");
      const keyEnvelope = await envResp.json();

      // 2. Desembrulhar a DEK via PBKDF2 (600.000 iterações) + AES-GCM
      const { sessionDek, vaultId } = await unwrapDek(passphrase, keyEnvelope);

      // 3. Carregar o index.enc
      const indexResp = await fetch("vault/index.enc");
      if (!indexResp.ok) throw new Error("Não foi possível carregar o índice criptografado da viagem.");
      const indexArrayBuffer = await indexResp.arrayBuffer();

      // 4. Decifrar o JSON de dados privados
      const privateData = await decryptIndex(sessionDek, indexArrayBuffer, vaultId);

      this.sessionDek = sessionDek;
      this.vaultId = vaultId;
      this.privateData = privateData;
      this.isUnlocked = true;

      window.dispatchEvent(new CustomEvent("vault:unlocked", { detail: { privateData } }));
      return privateData;
    } catch (err) {
      this.lock();
      throw err;
    }
  }

  /**
   * Tranca o cofre e elimina da memória todas as chaves e dados
   */
  lock() {
    this.sessionDek = null;
    this.vaultId = null;
    this.privateData = null;
    this.isUnlocked = false;
    clearTimeout(this.inactivityTimer);
    this._revokeAllBlobs();

    window.dispatchEvent(new CustomEvent("vault:locked"));
  }

  /**
   * Decifra um arquivo PDF sob demanda e retorna um Blob URL seguro
   */
  async getPdfBlobUrl(assetId) {
    if (!this.isUnlocked || !this.sessionDek) {
      throw new VaultCryptoError("O cofre precisa ser destravado antes de acessar comprovantes.");
    }

    const filePath = `vault/assets/${assetId}.enc`;
    const resp = await fetch(filePath);
    if (!resp.ok) {
      throw new VaultCryptoError(`Comprovante ${assetId} não encontrado no cofre.`);
    }

    const encBuffer = await resp.arrayBuffer();
    const pdfBytes = await decryptPdf(this.sessionDek, encBuffer, this.vaultId, assetId);

    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrls.add(blobUrl);

    // Retorna a URL e a função de revogação explícita
    return {
      url: blobUrl,
      size: pdfBytes.length,
      revoke: () => {
        if (this.activeBlobUrls.has(blobUrl)) {
          URL.revokeObjectURL(blobUrl);
          this.activeBlobUrls.delete(blobUrl);
        }
      }
    };
  }

  /**
   * Revoga todas as referências ativas de Blobs na memória
   */
  _revokeAllBlobs() {
    for (const url of this.activeBlobUrls) {
      URL.revokeObjectURL(url);
    }
    this.activeBlobUrls.clear();
  }

  /**
   * Retorna os dados privados se destravado
   */
  getData() {
    return this.isUnlocked ? this.privateData : null;
  }
}

export const vault = new VaultClient();
