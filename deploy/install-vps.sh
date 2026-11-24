#!/usr/bin/env bash
# RMM Console — Instalação em VPS Linux (Ubuntu 22.04/24.04 ou Debian 12)
# O domínio NÃO é fixo: ele é PERGUNTADO aqui (ou vem de $1 / $DOMAIN / .env).
# Uso interativo:  sudo bash deploy/install-vps.sh
# Uso direto:      sudo DOMAIN=meu.dominio.com bash deploy/install-vps.sh
#                  sudo bash deploy/install-vps.sh meu.dominio.com
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Descobre o domínio: argumento > variável DOMAIN > .env existente > PROMPT
DOMAIN="${1:-${DOMAIN:-}}"
if [ -z "$DOMAIN" ] && [ -f .env ]; then
  DOMAIN=$(grep -E '^DOMAIN=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)
fi
if [ -z "$DOMAIN" ]; then
  echo "Qual domínio vai apontar para esta VPS?"
  echo "Informe o subdomínio que você criou no DNS (registro A -> IP desta VPS)."
  read -rp "Domínio do sistema (sem https://, sem barra no final): " DOMAIN
fi
DOMAIN=$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##' | tr -d ' ')
if [ -z "$DOMAIN" ] || ! echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
  echo "ERRO: domínio inválido: '$DOMAIN'. Informe só o host do seu domínio." >&2
  exit 1
fi
PUBLIC_URL="https://$DOMAIN"
RMM_SERVER_URL="$PUBLIC_URL/actions"
echo "[rmm] Domínio informado: $DOMAIN"

echo "[rmm] Instalando dependências..."
apt-get update
apt-get install -y curl git ufw fail2ban unattended-upgrades
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban || true
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# 2) Grava o domínio no .env — é dele que docker-compose e o Caddy leem
if [ ! -f .env ]; then cp deploy/.env.example .env; fi
sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" .env
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" .env
sed -i "s|^RMM_SERVER_URL=.*|RMM_SERVER_URL=$RMM_SERVER_URL|" .env
if grep -q '^SESSION_SECRET=$' .env; then
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
fi
chmod 600 .env
echo "[rmm] .env atualizado com DOMAIN=$DOMAIN"

echo "[rmm] Base pronta:"
echo " 1) Confirme o DNS: registro A de $DOMAIN -> IP público desta VPS"
echo " 2) No painel, em Agentes > Criar o site, salve o nome do site e $PUBLIC_URL — o instalador do agente sai pré-configurado com ele"
echo " 3) Teste de fora: curl -I $PUBLIC_URL"

# 3) Sobe os TRÊS serviços (app + builder + caddy) a partir da RAIZ do projeto.
# NUNCA rode "docker compose" de dentro de deploy/: lá não há compose e o
# risco é subir um compose antigo/incompleto, só com o Caddy — o site
# responde 502 porque não há app ouvindo. Aqui subimos da raiz, com o
# docker-compose.yml completo (app construído pelo Dockerfile + Caddy).
# A primeira build do serviço builder demora alguns minutos: ele baixa
# Wine, o Python de Windows e o Inno Setup para compilar o .exe na VPS.
echo "[rmm] Subindo o sistema (rmm-app + rmm-builder + rmm-caddy)..."
echo "[rmm] A primeira build do builder (Wine + Inno Setup) pode demorar — é uma vez só."
docker compose up -d --build
docker compose ps
echo "[rmm] Pronto. Os TRÊS containers acima precisam estar 'Up'."
echo "[rmm] Se algo não subiu: docker compose logs app  /  docker compose logs builder"
echo "[rmm] No painel (Agentes), o botão 'Gerar pacote novo' compila o .exe aqui na VPS."
