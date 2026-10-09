# 🧭 Europa 2026 • Dossiê de Viagem & PWA Offline

> **Viajantes:** Diego, Tatiana e Fabiana  
> **Período:** 17 a 30 de Outubro de 2026  
> **Roteiro:** Florianópolis ➔ Lisboa ➔ Madrid ➔ Saillon (Suíça) ➔ Madrid ➔ Toledo (Congresso) ➔ Madrid ➔ Lisboa ➔ Florianópolis  
> **Hospedagem:** GitHub Pages (Repositório Público com Proteção Criptográfica Local)

---

## 🔒 Arquitetura de Segurança & Privacidade (P0.B)

Este aplicativo foi desenvolvido para ser hospedado gratuitamente e publicamente no **GitHub Pages**, sem expor nenhum dado pessoal, código de reserva (PNR), senha de cofre de acomodação ou documento em texto claro:

1. **Zero Documentos em Texto Claro no Git:** O arquivo `.gitignore` bloqueia terminantemente arquivos `*.pdf`, `*.zip` ou arquivos não-criptografados.
2. **Cofre EV26 (AES-GCM 256 bits + PBKDF2):** Todos os 16 comprovantes e bilhetes foram empacotados em envelopes binários `EV26` com AAD rígido.
3. **600.000 Iterações PBKDF2:** Proteção robusta contra ataques de força bruta offline em GPU.
4. **Chave de Sessão Volátil na Memória:** A chave é derivada e importada como `CryptoKey` não-exportável na memória RAM. Ao fechar a aba ou após 15 minutos de inatividade, o cofre tranca automaticamente.
5. **Revogação Segura de Memória:** Visualização de PDFs com limpeza automática de `Blob URLs` (`URL.revokeObjectURL`) para evitar travamento de memória no iOS Safari e Android Chrome.

---

## 🔑 Senha Mestre de Acesso

O cofre é protegido pela senha mestre definida no momento da selagem (`tools/seal_vault.py`).
Esta senha é confidencial e deve ser compartilhada apenas entre os viajantes (Diego, Tatiana e Fabiana).

---

## 🖥️ Como Testar Localmente no Navegador

Abra o terminal nesta pasta e inicie um servidor HTTP local:

```bash
cd "/media/diego/Users/Diego/Documents/Gnosis PC/europa-2026"
python3 -m http.server 8888
```

Abra no seu navegador:
👉 **`http://localhost:8888`**

### O que você verá:
1. **Hero Card "Agora / Próxima Etapa":** Mostra o status em tempo real do que fazer.
2. **Simulador de Datas:** Clique nas pílulas superiores (ex: **17/Out**, **18/Out**, **25/Out**) para testar e ver a interface se adaptando a cada dia da viagem!
3. **Cofre:** Clique no botão superior direito **`🔒 Destravar`**, insira sua senha mestre e veja todos os localizadores, telefones com discagem em 1 clique e botões de **"Abrir Comprovante PDF"** serem revelados instantaneamente!

---

## 🚀 Como Publicar no GitHub Pages

### 1. Crie um novo repositório no seu GitHub
- Acesse [github.com/new](https://github.com/new)
- Nome sugerido: `europa-2026` (ou `viagem-europa`)
- Escolha **Público** (graças à criptografia EV26 do cofre, seus dados confidenciais estão blindados)
- **Não** inicialize com README ou .gitignore (já criamos todos).

### 2. Faça o envio (Push) pelo terminal

```bash
cd "/media/diego/Users/Diego/Documents/Gnosis PC/europa-2026"

git init
git remote add origin https://github.com/<SEU_USUARIO_GITHUB>/europa-2026.git
git branch -M main
git add .
git commit -m "feat: lancamento do dossie de viagem europa 2026"
git push -u origin main
```

### 3. Ative o GitHub Pages
1. No seu repositório no GitHub, clique na aba **Settings** (Configurações).
2. No menu lateral esquerdo, clique em **Pages**.
3. Em **Build and deployment** -> **Branch**, selecione `main` e pasta `/(root)`.
4. Clique em **Save**.
5. Em cerca de 1 a 2 minutos, o GitHub exibirá a URL do seu site no ar:
   `https://<SEU_USUARIO_GITHUB>.github.io/europa-2026/`

---

## 📱 Como Instalar no Celular como App (PWA)

### No iPhone (iOS Safari):
1. Acesse o link do seu site no Safari.
2. Toque no botão de compartilhamento (ícone do quadrado com a seta para cima).
3. Role para baixo e selecione **Adicionar à Tela de Início**.
4. Toque em **Adicionar**. O ícone de bússola dourada aparecerá como um app nativo!
5. Abra o app, clique em **"Preparar Modo Avião"** para baixar os documentos para o cache do celular.

### No Android (Google Chrome):
1. Acesse o link no Chrome.
2. Toque nos 3 pontos no canto superior direito e selecione **Instalar aplicativo** (ou **Adicionar à tela inicial**).
3. Confirme a instalação.

---

## 🛠️ Como Atualizar ou Adicionar Novos Documentos

Se você fizer novas reservas (ex: a locação do carro em Genebra):
1. Coloque o PDF na sua pasta pessoal fora do repositório (`/media/diego/Users/Diego/Documents/Viagem/COngresso/`).
2. Adicione as informações no arquivo `tools/seal_vault.py`.
3. Execute o script:
   ```bash
   python3 tools/seal_vault.py
   ```
4. Faça commit e push dos arquivos `.enc` atualizados:
   ```bash
   git add vault/ data/
   git commit -m "docs: atualizacao de reservas"
   git push
   ```
