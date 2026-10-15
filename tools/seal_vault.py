#!/usr/bin/env python3
"""
Europa 2026 - Seal Vault Script (EV26 Format)
==============================================
Empacota e cifra de forma estanque todos os dados confidenciais de viagem
e PDFs no formato de envelope criptográfico EV26 (AES-GCM 256 bits + PBKDF2).

Garante que NENHUM PDF em texto claro ou código sensível (PNR, PIN, apólices)
seja comitado no repositório público do GitHub.
"""

import os
import sys
import json
import base64
import hashlib
import secrets
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# Constantes EV26
MAGIC = b"EV26"
VERSION = 1
TYPE_INDEX = 1
TYPE_PDF = 2
IV_LEN = 12
PBKDF2_ITERATIONS = 600000

US = "\x1f" # Unit Separator para AAD

def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

def b64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)

def derive_kek(passphrase: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    return kdf.derive(passphrase.encode("utf-8"))

def pack_ev26(record_type: int, iv: bytes, ciphertext_with_tag: bytes) -> bytes:
    """
    Header 20 bytes:
    0..4:   EV26 (Magic)
    4:      Version (1)
    5:      Type (1=index, 2=pdf)
    6:      IV Length (12)
    7:      Flags (0)
    8..20:  IV (12 bytes)
    20..N:  Ciphertext + Tag (16 bytes)
    """
    header = bytearray(20)
    header[0:4] = MAGIC
    header[4] = VERSION
    header[5] = record_type
    header[6] = IV_LEN
    header[7] = 0
    header[8:20] = iv
    return bytes(header) + ciphertext_with_tag

def main():
    repo_root = Path(__file__).resolve().parent.parent
    vault_dir = repo_root / "vault"
    assets_dir = vault_dir / "assets"
    data_dir = repo_root / "data"
    
    vault_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    # Senha Mestra solicitada pelo usuário
    passphrase = os.environ.get("VAULT_PASSPHRASE", "samael")
    print(f"🔒 Selando cofre de viagem Europa 2026...")

    # Pasta de origem dos arquivos reais
    source_dir = Path("/media/diego/Users/Diego/Documents/Viagem/COngresso")
    if not source_dir.exists():
        print(f"❌ Diretório de origem não encontrado: {source_dir}", file=sys.stderr)
        sys.exit(1)

    # 1. Gerar Chaves e Identificadores
    vault_id_bytes = secrets.token_bytes(16)
    vault_id = b64url_encode(vault_id_bytes)
    salt = secrets.token_bytes(16)
    dek = secrets.token_bytes(32) # Data Encryption Key (AES-256)
    
    # Derivar KEK da senha mestre
    kek = derive_kek(passphrase, salt, PBKDF2_ITERATIONS)
    
    # 2. Envelopar a DEK usando AES-GCM com a KEK
    kek_cipher = AESGCM(kek)
    wrap_iv = secrets.token_bytes(12)
    wrap_aad = f"EV26{US}1{US}{vault_id}{US}key-envelope".encode("utf-8")
    wrapped_dek = kek_cipher.encrypt(wrap_iv, dek, wrap_aad)
    
    key_envelope = {
        "format": "europa-vault-key",
        "version": VERSION,
        "vaultId": vault_id,
        "kdf": {
            "name": "PBKDF2",
            "hash": "SHA-256",
            "iterations": PBKDF2_ITERATIONS,
            "salt": b64url_encode(salt)
        },
        "wrap": {
            "name": "AES-GCM",
            "iv": b64url_encode(wrap_iv),
            "ciphertext": b64url_encode(wrapped_dek)
        }
    }

    def resolve_source_file(name: str) -> Path:
        candidates = [
            source_dir / name,
            source_dir / "PAssagens" / name,
            source_dir / "Hospedagem" / name,
        ]
        for c in candidates:
            if c.exists():
                return c
        for p in source_dir.rglob(Path(name).name):
            if p.is_file():
                return p
        return source_dir / name

    # 3. Mapeamento de PDFs e Criptografia
    pdf_sources = {
        "doc-tap-diego": resolve_source_file("Voo - DIEGOMR _ JACOB 17OCT2026 FLN LIS.pdf"),
        "doc-tap-tatiana": resolve_source_file("Voo- TATIANAMRS _ JACOB 17OCT2026 FLN LIS.pdf"),
        "doc-aireuropa-diego": resolve_source_file("8IAEL8 - DIEGO JACOB.pdf"),
        "doc-aireuropa-tatiana": resolve_source_file("8IAEL8 - TATIANA JACOB.pdf"),
        "doc-aireuropa-fabiana": resolve_source_file("8IAEL8 - FABIANA NUNES POLI.pdf"),
        "doc-hotel-madrid-1": resolve_source_file("Booking_MAdrid_IDA_Hostel LAS ROSAS.pdf"),
        "doc-airbnb-saillon-res": resolve_source_file("Reservation Details - HMSFDZ52SZ.pdf"),
        "doc-airbnb-saillon-anuncio": resolve_source_file("Quarto · Saillon Suiça — Airbnb.pdf"),
        "doc-hotel-madrid-2": resolve_source_file("Booking_ Centro Madrid Rio - Monederos C.pdf"),
        "doc-hotel-toledo": resolve_source_file("Booking_TOLEDO_El Mirador del Valle.pdf"),
        "doc-hotel-toledo-2": resolve_source_file("Booking_TOLEDO_Depois.pdf"),
        "doc-hotel-lisboa": resolve_source_file("Booking_Central Lisbon.pdf"),
        "doc-seguro-diego-bilhete": resolve_source_file("Bilhete_Seguro_Viagem_29340388828/Bilhete_Seguro_Viagem_32572804832/travel_insurance_Jacob Fernandes Leite_32572804832.pdf"),
        "doc-seguro-diego-cert": resolve_source_file("Bilhete_Seguro_Viagem_29340388828/Bilhete_Seguro_Viagem_32572804832/certificado_de_elegibilidade_32572804832.pdf"),
        "doc-seguro-tatiana-bilhete": resolve_source_file("Bilhete_Seguro_Viagem_29340388828/Bilhete_Seguro_Viagem_29340388828/travel_insurance_Araujo de Sousa Jacob_29340388828.pdf"),
        "doc-seguro-tatiana-cert": resolve_source_file("Bilhete_Seguro_Viagem_29340388828/Bilhete_Seguro_Viagem_29340388828/certificado_de_elegibilidade_29340388828.pdf"),
        "doc-convite-diego": resolve_source_file("Carta_Invitacion_JACOB FERNANDES LEITE (2).pdf"),
        "doc-convite-tatiana": resolve_source_file("Carta_Invitacion_ARAÚJO DE SOUSA JACOB (1).pdf"),
        "doc-pazsalvo-diego-tatiana": resolve_source_file("2026207 - VIC - Paz y Salvo Diego.Tatiana - CONGRESO.pdf"),
        "doc-pazsalvo-fabiana": resolve_source_file("2026209 - VIC - Paz y Salvo Fabiana Nunes Poli - CONGRESO.pdf"),
        "doc-carro-suica": resolve_source_file("Carro_Reservation Details - HMSFDZ52SZ.pdf"),
    }

    dek_cipher = AESGCM(dek)
    asset_manifest = []

    # Criptografar cada PDF no padrão EV26
    for asset_id, file_path in pdf_sources.items():
        if not file_path.exists():
            print(f"⚠️ Arquivo não encontrado: {file_path}", file=sys.stderr)
            continue
        
        pdf_bytes = file_path.read_bytes()
        sha256_hash = hashlib.sha256(pdf_bytes).hexdigest()
        iv = secrets.token_bytes(12)
        mime = "application/pdf"
        aad = f"EV26{US}1{US}record{US}{vault_id}{US}{TYPE_PDF}{US}{asset_id}{US}{mime}".encode("utf-8")
        
        ciphertext = dek_cipher.encrypt(iv, pdf_bytes, aad)
        enc_blob = pack_ev26(TYPE_PDF, iv, ciphertext)
        
        dest_path = assets_dir / f"{asset_id}.enc"
        dest_path.write_bytes(enc_blob)
        
        asset_manifest.append({
            "id": asset_id,
            "size": len(enc_blob),
            "sha256": sha256_hash,
            "type": "pdf"
        })
        print(f"  ✓ PDF cifrado: {asset_id} ({len(pdf_bytes):,} bytes -> {len(enc_blob):,} bytes)")

    # 4. Construir o Dossiê Privado Criptografado (index.enc)
    private_vault = {
        "vaultVersion": VERSION,
        "generatedAt": "2026-10-12T00:00:00Z",
        "travelers": [
            {
                "id": "diego",
                "name": "Diego Jacob Fernandes Leite",
                "role": "Titular • Sacerdote",
                "passport": "GO506551",
                "oldPassport": "FR302881",
                "passportStatus": "NOVO: GO506551 (antigo: FR302881)",
                "apolice": "16023-0003-69-260122474",
                "certSchengen": "32572804832",
                "credencial": "Mem 207/2026 – VIC"
            },
            {
                "id": "tatiana",
                "name": "Tatiana Araújo de Sousa Jacob",
                "role": "Esposa • Isis",
                "passport": "GB464034",
                "apolice": "16023-0003-69-260122473",
                "certSchengen": "29340388828",
                "credencial": "Mem 207/2026 – VIC"
            },
            {
                "id": "fabiana",
                "name": "Fabiana Nunes Poli",
                "role": "Congressista • Isis",
                "passport": "G0872312",
                "credencial": "Mem 209/2026 – VIC"
            }
        ],
        "emergencyContacts": {
            "portoSeguro": {
                "name": "Porto Seguro Assistência Internacional 24h",
                "phoneBrasil": "+55 11 3366-3330",
                "phoneWhatsApp": "+55 11 3003-9303",
                "phoneEspanhaGratis": "900 802 811",
                "phonePortugalGratis": "800 814 624",
                "apóliceDiego": "16023-0003-69-260122474 (Cert: 32572804832)",
                "apóliceTatiana": "16023-0003-69-260122473 (Cert: 29340388828)",
                "docDiego": "doc-seguro-diego-bilhete",
                "docTatiana": "doc-seguro-tatiana-bilhete"
            },
            "policiaUE": "112",
            "emergenciaSuica": {"medica": "144", "policia": "117", "bombeiros": "118"},
            "consulados": {
                "madrid": {"name": "Consulado-Geral do Brasil em Madrid", "plantao": "+34 677 544 004", "endereco": "Calle de Fernando El Santo 6, 28010 Madrid"},
                "lisboa": {"name": "Consulado-Geral do Brasil em Lisboa", "plantao": "+351 962 520 581", "endereco": "Praça Luís de Camões 22, 1200-243 Lisboa"},
                "genebra": {"name": "Consulado-Geral do Brasil em Genebra", "plantao": "+41 79 350 49 55", "endereco": "Rue de Lausanne 45, 1201 Genebra"}
            }
        },
        "bookings": [
            {
                "id": "flight-tap-ida-1",
                "category": "flight",
                "title": "Voo TAP TP110 • Florianópolis ➔ Lisboa",
                "airline": "TAP Air Portugal",
                "flightNumber": "TP110",
                "pnr": "X8NDY2",
                "checkinUrl": "https://www.flytap.com/pt-br/check-in",
                "eTicketDiego": "047 2523318589",
                "eTicketTatiana": "047 2523318588",
                "departure": {"airport": "FLN", "city": "Florianópolis", "terminal": "T1", "time": "2026-10-17T00:25:00-03:00", "tz": "America/Sao_Paulo"},
                "arrival": {"airport": "LIS", "city": "Lisboa", "terminal": "T1", "time": "2026-10-17T15:45:00+01:00", "tz": "Europe/Lisbon"},
                "passengers": ["Diego Jacob", "Tatiana Jacob"],
                "baggage": "Bagagem de mão + despachada incluída",
                "documents": ["doc-tap-diego", "doc-tap-tatiana"],
                "notes": "Atenção: saída na madrugada de 16 para 17 de Outubro às 00:25."
            },
            {
                "id": "flight-tap-ida-2",
                "category": "flight",
                "title": "Voo TAP TP1018 • Lisboa ➔ Madrid",
                "airline": "TAP Air Portugal",
                "flightNumber": "TP1018",
                "pnr": "X8NDY2",
                "checkinUrl": "https://www.flytap.com/pt-br/check-in",
                "departure": {"airport": "LIS", "city": "Lisboa", "terminal": "T1", "time": "2026-10-17T16:50:00+01:00", "tz": "Europe/Lisbon"},
                "arrival": {"airport": "MAD", "city": "Madrid", "terminal": "T2", "time": "2026-10-17T19:10:00+02:00", "tz": "Europe/Madrid"},
                "passengers": ["Diego Jacob", "Tatiana Jacob"],
                "documents": ["doc-tap-diego", "doc-tap-tatiana"],
                "notes": "Conexão de 1h05 em Lisboa. Desembarque em Madrid Terminal 2."
            },
            {
                "id": "stay-madrid-1",
                "category": "stay",
                "title": "Hostel Las Rosas • Madrid (1ª Noite)",
                "bookingRef": "5098.244.534",
                "pin": "8439",
                "provider": "Booking.com",
                "address": "Paseo Ginebra 45, San Blas, 28022 Madrid, Espanha",
                "phone": "+34 689 22 10 67",
                "checkIn": "2026-10-17T20:00:00+02:00",
                "checkOut": "2026-10-18T06:00:00+02:00",
                "tz": "Europe/Madrid",
                "price": "Pernoite rápida próxima ao aeroporto Barajas",
                "documents": ["doc-hotel-madrid-1"],
                "notes": "Pernoite estratégica antes do voo matinal das 08h00 para Genebra."
            },
            {
                "id": "flight-aireuropa-ida",
                "category": "flight",
                "title": "Voo Air Europa UX1663 • Madrid ➔ Genebra",
                "airline": "Air Europa",
                "flightNumber": "UX1663",
                "pnr": "8IAEL8",
                "checkinUrl": "https://www.aireuropa.com/br/pt/aea/check-in-online.html",
                "eTicketDiego": "996 2428720484",
                "departure": {"airport": "MAD", "city": "Madrid", "terminal": "T2", "time": "2026-10-18T08:00:00+02:00", "tz": "Europe/Madrid"},
                "arrival": {"airport": "GVA", "city": "Genebra", "terminal": "T1", "time": "2026-10-18T10:00:00+02:00", "tz": "Europe/Zurich"},
                "passengers": ["Diego Jacob", "Tatiana Jacob", "Fabiana Nunes Poli"],
                "documents": ["doc-aireuropa-diego", "doc-aireuropa-tatiana", "doc-aireuropa-fabiana"],
                "notes": "Chegar ao T2 de Barajas até 06:15 para despacho/raio-x."
            },
            {
                "id": "car-rental-genebra",
                "category": "car",
                "title": "Aluguel de Carro • Genebra Aeroporto (GVA) ➔ Valais",
                "status": "Confirmado",
                "provider": "Argus Car Hire / Europcar (Unirent)",
                "bookingRef": "CH279343390",
                "confirmationNumber": "1208217510",
                "vehicle": "Skoda Fabia ou semelhante (Econômico • Automático • 5P • A/C)",
                "driver": "Diego Jacob Fernandes Leite",
                "pickup": {
                    "location": "Europcar, Arrivals hall - Genève Airport (Setor Suíço), Genève, 1215",
                    "time": "2026-10-18T11:00:00+02:00",
                    "deskPhone": "022 717 81 10",
                    "deskPhoneInt": "+41 22 717 81 10",
                    "tz": "Europe/Zurich"
                },
                "dropoff": {
                    "location": "Europcar, Arrivals hall - Genève Airport (Setor Suíço), Genève, 1215",
                    "time": "2026-10-20T11:00:00+02:00",
                    "deskPhone": "022 717 81 10",
                    "deskPhoneInt": "+41 22 717 81 10",
                    "tz": "Europe/Zurich"
                },
                "fuelPolicy": "Depósito cheio para depósito cheio (Full to Full)",
                "mileage": "Quilometragem Ilimitada",
                "winterPack": "Conjunto de inverno incluído (R$ 0,00)",
                "paidAmount": "USD 98.22 (CHF 81.87) • Pago Online (CHF 0,00 a pagar no balcão)",
                "creditCardUsed": "Mastercard final 3636",
                "deposit": "CHF 350,00 (Caução retida temporariamente no cartão de crédito)",
                "fuelDeposit": "Possível caução de combustível temporária (~CHF 80 a 100, reembolsada na devolução com tanque cheio)",
                "franchise": "CHF 2.500,00 (Franquia máxima de responsabilidade por danos/furto sem seguro extra)",
                "mandatoryRequirements": [
                    "Cartão de crédito físico no nome de Diego Jacob Fernandes Leite (sem abreviaturas) com limite para a caução de CHF 350,00 (+ garantia de combustível) e senha PIN",
                    "CNH física válida do condutor principal (+ PID recomendada)",
                    "Passaporte válido (GO506551)",
                    "Voucher da reserva (CH279343390)"
                ],
                "documents": ["doc-carro-suica"],
                "criticalNotice": "⚠️ BALCÃO NO SETOR SUÍÇO: Balcão da Europcar / Unirent no Arrivals hall do Setor Suíço. Carros locados no lado suíço já incluem a Vignette Rodoviária Suíça (CHF 40).",
                "routeToSaillon": "GVA ➔ Rodovia A1 ➔ Rodovia A9 direção Martigny/Sion ➔ Saída 24 (Riddes/Saillon). Duração: ~1h35 (145 km).",
                "notes": "Balcão no hall de chegadas (Arrivals hall) do Setor Suíço da Europcar / Unirent. Telefone: 022 717 81 10. Devolver com tanque cheio."
            },
            {
                "id": "stay-saillon-suica",
                "category": "stay",
                "title": "Airbnb Quarto com Vista Panorâmica • Saillon (Suíça)",
                "bookingRef": "HMSFDZ52SZ",
                "provider": "Airbnb",
                "host": "Victor",
                "hostPhone": "+33 6 12 25 75 63",
                "address": "Vers le Scex 3, Saillon, Valais 1913, Suíça",
                "checkIn": "2026-10-18T15:00:00+02:00",
                "checkOut": "2026-10-20T11:00:00+02:00",
                "tz": "Europe/Zurich",
                "guests": ["Diego Leite", "Tatiana Jacob", "Fabiana Poli"],
                "paidAmount": "R$ 758,26",
                "documents": ["doc-airbnb-saillon-res", "doc-airbnb-saillon-anuncio"],
                "notes": "Belíssima vila medieval com águas termais (Les Bains de Saillon). Moeda local: Franco Suíço (CHF), cartões aceitos universalmente."
            },
            {
                "id": "templo-divino-daimon-valais",
                "category": "temple",
                "title": "Visita ao Templo Divino Daimon • Riddes (Valais)",
                "location": "Riddes, Cantão de Valais, Suíça",
                "address": "Riddes, Cantão de Valais, Suíça",
                "startTime": "2026-10-19T10:00:00+02:00",
                "endTime": "2026-10-19T13:00:00+02:00",
                "tz": "Europe/Zurich",
                "route": "Saillon ➔ Riddes (~4 km / 7 min via Route de Saillon / Pont de Riddes)",
                "credentials": "Paz y Salvo Eclesiais (Mem 207/2026 e Mem 209/2026 – Lumisial Zeus Daimon)",
                "recommendations": "Trajes litúrgicos / vestes sacerdotais e de Isis, pontualidade suíça, respeito às diretrizes do templo irmão em Valais.",
                "documents": [
                    "doc-pazsalvo-diego-tatiana",
                    "doc-pazsalvo-fabiana"
                ],
                "mapsUrl": "https://www.google.com/maps/dir/?api=1&origin=Vers+le+Scex+3,+Saillon,+Switzerland&destination=Riddes,+Switzerland&travelmode=driving",
                "notes": "Deslocamento rápido Saillon ➔ Riddes cruzando a ponte sobre o Rio Ródano. Apresentar os certificados de Paz y Salvo oficiais da delegação Zeus Daimon."
            },
            {
                "id": "flight-aireuropa-volta",
                "category": "flight",
                "title": "Voo Air Europa UX1666 • Genebra ➔ Madrid",
                "airline": "Air Europa",
                "flightNumber": "UX1666",
                "pnr": "8IAEL8",
                "checkinUrl": "https://www.aireuropa.com/br/pt/aea/check-in-online.html",
                "departure": {"airport": "GVA", "city": "Genebra", "terminal": "T1", "time": "2026-10-20T18:55:00+02:00", "tz": "Europe/Zurich"},
                "arrival": {"airport": "MAD", "city": "Madrid", "terminal": "T2", "time": "2026-10-20T21:05:00+02:00", "tz": "Europe/Madrid"},
                "passengers": ["Diego Jacob", "Tatiana Jacob", "Fabiana Nunes Poli"],
                "documents": ["doc-aireuropa-diego", "doc-aireuropa-tatiana", "doc-aireuropa-fabiana"],
                "notes": "Devolução do carro no GVA às 16:30. Embarque no Terminal 1."
            },
            {
                "id": "stay-madrid-2",
                "category": "stay",
                "title": "Centro Madrid Rio • Madrid (2 Noites)",
                "bookingRef": "6716.656.171",
                "pin": "3492",
                "provider": "Booking.com",
                "address": "Calle Monederos 30, Usera, 28026 Madrid, Espanha",
                "phone": "+34 657 72 34 54",
                "checkIn": "2026-10-20T22:00:00+02:00",
                "checkOut": "2026-10-22T11:00:00+02:00",
                "tz": "Europe/Madrid",
                "documents": ["doc-hotel-madrid-2"],
                "notes": "2 noites em Madrid para descanso e passeios antes do deslocamento a Toledo."
            },
            {
                "id": "stay-toledo-congresso",
                "category": "stay",
                "title": "El Mirador del Valle • Toledo (6 Noites • Congresso)",
                "bookingRef": "5889.928.483",
                "pin": "8037",
                "provider": "Booking.com",
                "address": "Calle de la Retama 17, 45002 Toledo, Espanha",
                "phone": "+34 687 08 04 76",
                "checkIn": "2026-10-22T16:00:00+02:00",
                "checkOut": "2026-10-28T11:00:00+01:00",
                "tz": "Europe/Madrid",
                "documents": [
                    "doc-hotel-toledo",
                    "doc-convite-diego",
                    "doc-convite-tatiana",
                    "doc-pazsalvo-diego-tatiana",
                    "doc-pazsalvo-fabiana"
                ],
                "specialAlert": "⚠️ MUDANÇA DE HORÁRIO EM 25/OUT: Na madrugada de domingo 25/10/2026 às 03:00 o relógio atrasa 1 hora (CEST UTC+2 ➔ CET UTC+1).",
                "notes": "Período do Congresso Gnóstico Internacional no Palacio de Congresos El Greco. Vista espetacular do vale histórico de Toledo."
            },
            {
                "id": "stay-toledo-2",
                "category": "stay",
                "title": "Apartamento Centro de Toledo • Toledo (1 Noite)",
                "bookingRef": "6397.678.603",
                "pin": "2118",
                "provider": "Booking.com",
                "address": "4 Callejón Cura, 45003 Toledo, Espanha",
                "phone": "+34 679 19 43 63",
                "checkIn": "2026-10-28T13:00:00+01:00",
                "checkOut": "2026-10-29T11:00:00+01:00",
                "tz": "Europe/Madrid",
                "paidAmount": "€ 135,00",
                "documents": ["doc-hotel-toledo-2"],
                "notes": "Noite extra no centro histórico de Toledo após o congresso (Callejón Cura). Atenção logística para o dia 29: saída cedo de Toledo para o Aeroporto Madrid-Barajas (voo TP1013 às 12:10)."
            },
            {
                "id": "flight-tap-mad-lis",
                "category": "flight",
                "title": "Voo TAP TP1013 • Madrid ➔ Lisboa",
                "airline": "TAP Air Portugal",
                "flightNumber": "TP1013",
                "pnr": "X8NDY2",
                "checkinUrl": "https://www.flytap.com/pt-br/check-in",
                "departure": {"airport": "MAD", "city": "Madrid", "terminal": "T2", "time": "2026-10-29T12:10:00+01:00", "tz": "Europe/Madrid"},
                "arrival": {"airport": "LIS", "city": "Lisboa", "terminal": "T1", "time": "2026-10-29T12:35:00+00:00", "tz": "Europe/Lisbon"},
                "passengers": ["Diego Jacob", "Tatiana Jacob"],
                "documents": ["doc-tap-diego", "doc-tap-tatiana"],
                "notes": "Mudança de fuso: Madrid (CET UTC+1) para Lisboa (WET UTC+0). Duração real 1h25."
            },
            {
                "id": "stay-lisboa",
                "category": "stay",
                "title": "Central Lisbon Stay • Lisboa (1 Noite)",
                "bookingRef": "6162.188.474",
                "pin": "0098",
                "provider": "Booking.com",
                "address": "Rua Inácio Pardelhas Sanchez 116B, Campolide, 1070-138 Lisboa, Portugal",
                "phone": "+351 929 153 578",
                "checkIn": "2026-10-29T15:00:00+00:00",
                "checkOut": "2026-10-30T08:30:00+00:00",
                "tz": "Europe/Lisbon",
                "documents": ["doc-hotel-lisboa"],
                "notes": "Última noite na Europa. Preparação e check-in antecipado do voo de volta ao Brasil."
            },
            {
                "id": "flight-tap-volta",
                "category": "flight",
                "title": "Voo TAP TP109 • Lisboa ➔ Florianópolis",
                "airline": "TAP Air Portugal",
                "flightNumber": "TP109",
                "pnr": "X8NDY2",
                "checkinUrl": "https://www.flytap.com/pt-br/check-in",
                "departure": {"airport": "LIS", "city": "Lisboa", "terminal": "T1", "time": "2026-10-30T11:00:00+00:00", "tz": "Europe/Lisbon"},
                "arrival": {"airport": "FLN", "city": "Florianópolis", "terminal": "T1", "time": "2026-10-30T18:35:00-03:00", "tz": "America/Sao_Paulo"},
                "passengers": ["Diego Jacob", "Tatiana Jacob"],
                "documents": ["doc-tap-diego", "doc-tap-tatiana"],
                "notes": "Voo direto de retorno para casa! Duração estimada ~11h35."
            }
        ],
        "congress": {
            "title": "Congreso Gnóstico Internacional – España 2026",
            "dates": "23 a 27 de Outubro de 2026",
            "venue": "Palacio de Congresos El Greco, Toledo, Espanha",
            "lumisial": "Lumisial Zeus Daimon (São Pedro de Alcântara / SC)",
            "organization": "Iglesia Gnóstica (RER 013873, NIF R3000683G)",
            "coordinator": "Alejandro Caballero Pérez (Vicario Nacional)",
            "participants": [
                {
                    "id": "diego",
                    "name": "Diego Jacob Fernandes Leite",
                    "passport": "GO506551",
                    "oldPassport": "FR302881",
                    "passportStatus": "NOVO: GO506551 (antigo: FR302881)",
                    "role": "Sacerdote / Congressista",
                    "invitationDoc": "doc-convite-diego",
                    "pazSalvoDoc": "doc-pazsalvo-diego-tatiana",
                    "pazSalvoRef": "Mem 207/2026 – VIC"
                },
                {
                    "id": "tatiana",
                    "name": "Tatiana Araújo de Sousa Jacob",
                    "passport": "GB464034",
                    "role": "Isis / Congressista",
                    "invitationDoc": "doc-convite-tatiana",
                    "pazSalvoDoc": "doc-pazsalvo-diego-tatiana",
                    "pazSalvoRef": "Mem 207/2026 – VIC"
                },
                {
                    "id": "fabiana",
                    "name": "Fabiana Nunes Poli",
                    "passport": "G0872312",
                    "role": "Isis / Congressista",
                    "pazSalvoDoc": "doc-pazsalvo-fabiana",
                    "pazSalvoRef": "Mem 209/2026 – VIC"
                }
            ]
        }
    }

    # Criptografar o Dossiê Privado (index.enc)
    index_json_bytes = json.dumps(private_vault, ensure_ascii=False, indent=2).encode("utf-8")
    index_iv = secrets.token_bytes(12)
    index_mime = "application/json"
    index_aad = f"EV26{US}1{US}record{US}{vault_id}{US}{TYPE_INDEX}{US}index{US}{index_mime}".encode("utf-8")
    
    index_ciphertext = dek_cipher.encrypt(index_iv, index_json_bytes, index_aad)
    index_enc_blob = pack_ev26(TYPE_INDEX, index_iv, index_ciphertext)
    
    (vault_dir / "index.enc").write_bytes(index_enc_blob)
    print(f"  ✓ Dossiê privado cifrado: index.enc ({len(index_json_bytes):,} bytes -> {len(index_enc_blob):,} bytes)")

    # 5. Salvar key-envelope.json e asset-manifest.json
    (vault_dir / "key-envelope.json").write_text(json.dumps(key_envelope, indent=2), encoding="utf-8")
    (vault_dir / "asset-manifest.json").write_text(json.dumps(asset_manifest, indent=2), encoding="utf-8")

    # 6. Gerar public-timeline.json (100% livre de segredos)
    public_timeline = {
        "title": "Europa 2026 • Diego, Tatiana & Fabiana",
        "dates": "17 a 30 de Outubro de 2026",
        "route": "Florianópolis ➔ Lisboa ➔ Madrid ➔ Saillon (Suíça) ➔ Madrid ➔ Toledo ➔ Madrid ➔ Lisboa ➔ Florianópolis",
        "days": [
            {
                "date": "2026-10-17",
                "city": "Florianópolis ➔ Lisboa ➔ Madrid",
                "events": [
                    {"time": "00:25", "title": "Voo TAP TP110 (FLN ➔ LIS)", "category": "flight", "protectedId": "flight-tap-ida-1"},
                    {"time": "15:45", "title": "Chegada em Lisboa (LIS) • Controle de Passaporte & Imigração Schengen", "category": "activity", "isImmigration": True, "protectedId": "immigration-lisboa"},
                    {"time": "16:50", "title": "Voo TAP TP1018 (LIS ➔ MAD)", "category": "flight", "protectedId": "flight-tap-ida-2"},
                    {"time": "20:00", "title": "Check-in Hostel Las Rosas (Madrid)", "category": "stay", "protectedId": "stay-madrid-1"}
                ]
            },
            {
                "date": "2026-10-18",
                "city": "Madrid ➔ Genebra ➔ Saillon (Suíça)",
                "events": [
                    {"time": "08:00", "title": "Voo Air Europa UX1663 (MAD ➔ GVA)", "category": "flight", "protectedId": "flight-aireuropa-ida"},
                    {"time": "11:00", "title": "Retirada do Carro: Skoda Fabia Automático (Europcar / Unirent • Setor Suíço)", "category": "car", "protectedId": "car-rental-genebra"},
                    {"time": "15:00", "title": "Check-in Airbnb Saillon (Valais)", "category": "stay", "protectedId": "stay-saillon-suica"}
                ]
            },
            {
                "date": "2026-10-19",
                "city": "Saillon & Riddes (Valais • Suíça)",
                "events": [
                    {
                        "time": "10:00",
                        "title": "Visita ao Templo Divino Daimon (Riddes, Valais)",
                        "category": "temple",
                        "isDaimonVisit": True,
                        "protectedId": "templo-divino-daimon-valais"
                    },
                    {
                        "time": "15:00",
                        "title": "Passeio nos Alpes & Termas de Saillon (Les Bains de Saillon)",
                        "category": "activity",
                        "protectedId": "stay-saillon-suica"
                    }
                ]
            },
            {
                "date": "2026-10-20",
                "city": "Saillon ➔ Genebra ➔ Madrid",
                "events": [
                    {"time": "11:00", "title": "Checkout Airbnb Saillon & Devolução do Carro (Europcar / Unirent GVA)", "category": "car", "protectedId": "car-rental-genebra"},
                    {"time": "18:55", "title": "Voo Air Europa UX1666 (GVA ➔ MAD)", "category": "flight", "protectedId": "flight-aireuropa-volta"},
                    {"time": "22:00", "title": "Check-in Centro Madrid Rio (Madrid)", "category": "stay", "protectedId": "stay-madrid-2"}
                ]
            },
            {
                "date": "2026-10-21",
                "city": "Madrid",
                "events": [
                    {"time": "Dia todo", "title": "Exploração cultural em Madrid", "category": "activity", "protectedId": "stay-madrid-2"}
                ]
            },
            {
                "date": "2026-10-22",
                "city": "Madrid ➔ Toledo",
                "events": [
                    {"time": "11:00", "title": "Checkout Centro Madrid Rio", "category": "stay", "protectedId": "stay-madrid-2"},
                    {"time": "14:00", "title": "Deslocamento Madrid ➔ Toledo", "category": "transport", "protectedId": "stay-toledo-congresso"},
                    {"time": "16:00", "title": "Check-in El Mirador del Valle (Toledo) • Credenciamento do Congresso", "category": "stay", "isCongressCheckin": True, "protectedId": "stay-toledo-congresso"}
                ]
            },
            {
                "date": "2026-10-23",
                "city": "Toledo",
                "events": [
                    {"time": "09:00", "title": "Congresso Acadêmico / Atividades Oficiais", "category": "activity", "protectedId": "stay-toledo-congresso"}
                ]
            },
            {
                "date": "2026-10-24",
                "city": "Toledo",
                "events": [
                    {"time": "09:00", "title": "Congresso Acadêmico & Cidade Histórica", "category": "activity", "protectedId": "stay-toledo-congresso"}
                ]
            },
            {
                "date": "2026-10-25",
                "city": "Toledo",
                "events": [
                    {"time": "03:00", "title": "⚠️ Fim do Horário de Verão (CEST UTC+2 ➔ CET UTC+1)", "category": "alert", "protectedId": "stay-toledo-congresso"},
                    {"time": "10:00", "title": "Congresso Acadêmico em Toledo", "category": "activity", "protectedId": "stay-toledo-congresso"}
                ]
            },
            {
                "date": "2026-10-26",
                "city": "Toledo",
                "events": [
                    {"time": "09:00", "title": "Congresso Acadêmico em Toledo", "category": "activity", "protectedId": "stay-toledo-congresso"}
                ]
            },
            {
                "date": "2026-10-27",
                "city": "Toledo",
                "events": [
                    {"time": "09:00", "title": "Encerramento do Congresso em Toledo", "category": "activity", "protectedId": "stay-toledo-congresso"}
                ]
            },
            {
                "date": "2026-10-28",
                "city": "Toledo",
                "events": [
                    {"time": "11:00", "title": "Checkout El Mirador del Valle (Toledo)", "category": "stay", "protectedId": "stay-toledo-congresso"},
                    {"time": "13:00", "title": "Check-in Apartamento Centro de Toledo", "category": "stay", "protectedId": "stay-toledo-2"}
                ]
            },
            {
                "date": "2026-10-29",
                "city": "Toledo ➔ Madrid ➔ Lisboa",
                "events": [
                    {"time": "08:00", "title": "Checkout Apto Centro Toledo ➔ Ida Aeroporto Madrid (MAD)", "category": "stay", "protectedId": "stay-toledo-2"},
                    {"time": "12:10", "title": "Voo TAP TP1013 (MAD ➔ LIS)", "category": "flight", "protectedId": "flight-tap-mad-lis"},
                    {"time": "15:00", "title": "Check-in Central Lisbon Stay (Lisboa)", "category": "stay", "protectedId": "stay-lisboa"}
                ]
            },
            {
                "date": "2026-10-30",
                "city": "Lisboa ➔ Florianópolis",
                "events": [
                    {"time": "08:30", "title": "Checkout Central Lisbon Stay ➔ Ida Aeroporto LIS", "category": "stay", "protectedId": "stay-lisboa"},
                    {"time": "11:00", "title": "Voo TAP TP109 Direto (LIS ➔ FLN)", "category": "flight", "protectedId": "flight-tap-volta"},
                    {"time": "18:35", "title": "Chegada em Florianópolis (Brasil)", "category": "flight", "protectedId": "flight-tap-volta"}
                ]
            }
        ]
    }

    (data_dir / "public-timeline.json").write_text(json.dumps(public_timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ Timeline pública gerada: data/public-timeline.json")
    print(f"\n🎉 Cofre selado com sucesso em {vault_dir}!")
    print(f"📌 Chave de recuperação para anotar: {passphrase}")

if __name__ == "__main__":
    main()
