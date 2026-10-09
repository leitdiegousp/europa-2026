/**
 * Europa 2026 - Crypto Format Module (EV26)
 * ==========================================
 * Implementação cliente pura com Web Crypto API (SubtleCrypto)
 * Suporte a PBKDF2 (600.000 iterações), AES-GCM 256 bits e validação de AAD.
 */

export const FORMAT_VERSION = 1;

export const RECORD_TYPE = Object.freeze({
  INDEX: 1,
  PDF: 2
});

const MAGIC = Uint8Array.of(0x45, 0x56, 0x32, 0x36); // ASCII "EV26"
const HEADER_BYTES = 20;
const US = "\x1f"; // Unit Separator para AAD

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class VaultCryptoError extends Error {
  constructor(message = "Erro de integridade ou autenticação no cofre.") {
    super(message);
    this.name = "VaultCryptoError";
  }
}

/**
 * Converte base64url para Uint8Array
 */
export function b64urlToBytes(base64url) {
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converte Uint8Array para base64url
 */
export function bytesToB64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Valida o cabeçalho EV26 e decompõe o buffer
 */
export function parseEnvelope(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < HEADER_BYTES + 16) {
    throw new VaultCryptoError("Envelope corrompido: tamanho inferior ao cabeçalho mínimo.");
  }

  // Verificar Magic "EV26"
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new VaultCryptoError("Envelope inválido: assinatura mágica EV26 não encontrada.");
    }
  }

  const version = bytes[4];
  if (version !== FORMAT_VERSION) {
    throw new VaultCryptoError(`Versão de envelope não suportada: ${version}`);
  }

  const recordType = bytes[5];
  const ivLen = bytes[6];
  if (ivLen !== 12) {
    throw new VaultCryptoError(`Tamanho de IV não suportado: ${ivLen} (esperado 12 bytes)`);
  }

  const iv = bytes.subarray(8, 20);
  const ciphertextWithTag = bytes.subarray(20);

  return {
    version,
    recordType,
    iv,
    ciphertextWithTag
  };
}

/**
 * Deriva a KEK (Key Encryption Key) da senha mestra via PBKDF2
 */
export async function deriveKek(passphrase, saltBytes, iterations = 600000) {
  const passBytes = encoder.encode(passphrase);
  
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passBytes,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const kek = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: iterations,
      hash: "SHA-256"
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false, // extractable: false
    ["decrypt"]
  );

  return kek;
}

/**
 * Desembrulha a DEK (Data Encryption Key) a partir do key-envelope.json
 */
export async function unwrapDek(passphrase, keyEnvelope) {
  if (!keyEnvelope || keyEnvelope.format !== "europa-vault-key") {
    throw new VaultCryptoError("Formato de envelope de chave desconhecido.");
  }

  const saltBytes = b64urlToBytes(keyEnvelope.kdf.salt);
  const iterations = keyEnvelope.kdf.iterations || 600000;
  const wrapIv = b64urlToBytes(keyEnvelope.wrap.iv);
  const wrappedDek = b64urlToBytes(keyEnvelope.wrap.ciphertext);
  const vaultId = keyEnvelope.vaultId;

  // Derivar KEK da senha mestra
  const kek = await deriveKek(passphrase, saltBytes, iterations);

  // AAD do envelope de chave
  const wrapAad = encoder.encode(`EV26${US}1${US}${vaultId}${US}key-envelope`);

  try {
    const rawDek = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: wrapIv,
        additionalData: wrapAad
      },
      kek,
      wrappedDek
    );

    // Importar DEK como CryptoKey não-exportável de sessão
    const sessionDek = await crypto.subtle.importKey(
      "raw",
      rawDek,
      { name: "AES-GCM" },
      false, // Chave NUNCA pode ser exportada ou vazada da RAM
      ["decrypt"]
    );

    return { sessionDek, vaultId };
  } catch (err) {
    throw new VaultCryptoError("Senha incorreta ou integridade do cofre violada.");
  }
}

/**
 * Decifra um registro (index ou PDF) com a DEK de sessão e verifica o AAD
 */
export async function decryptRecord(dek, envelopeBuffer, vaultId, recordType, assetId, mime) {
  const parsed = parseEnvelope(envelopeBuffer);

  if (parsed.recordType !== recordType) {
    throw new VaultCryptoError(`Tipo de registro inconsistente: esperado ${recordType}, obtido ${parsed.recordType}`);
  }

  const aadString = `EV26${US}1${US}record${US}${vaultId}${US}${recordType}${US}${assetId}${US}${mime}`;
  const aad = encoder.encode(aadString);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: parsed.iv,
        additionalData: aad
      },
      dek,
      parsed.ciphertextWithTag
    );

    return new Uint8Array(decryptedBuffer);
  } catch (err) {
    throw new VaultCryptoError(`Falha ao decifrar registro ${assetId}. Erro de autenticação GCM.`);
  }
}

/**
 * Decifra o índice privado JSON
 */
export async function decryptIndex(dek, envelopeBuffer, vaultId) {
  const decryptedBytes = await decryptRecord(dek, envelopeBuffer, vaultId, RECORD_TYPE.INDEX, "index", "application/json");
  const jsonText = decoder.decode(decryptedBytes);
  return JSON.parse(jsonText);
}

/**
 * Decifra um arquivo PDF e retorna um Uint8Array dos bytes crus
 */
export async function decryptPdf(dek, envelopeBuffer, vaultId, assetId) {
  return await decryptRecord(dek, envelopeBuffer, vaultId, RECORD_TYPE.PDF, assetId, "application/pdf");
}
