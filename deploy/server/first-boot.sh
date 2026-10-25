#!/bin/bash
# Runs once when Lightsail creates the server (user data). Installs Docker
# from Ubuntu's own packages and adds 2 GB of swap as a safety margin.
set -euxo pipefail
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 unattended-upgrades
systemctl enable --now docker
install -d -m 750 /opt/voltneo
touch /var/lib/voltneo-first-boot-done
