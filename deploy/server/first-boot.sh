#!/bin/bash
# Runs once on a new server: as Lightsail user data, and again over SSH by
# deploy/aws/deploy.sh if it has not finished. Installs Docker
# from Ubuntu's own packages and adds 2 GB of swap as a safety margin.
set -euxo pipefail
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=300 update
apt-get -o DPkg::Lock::Timeout=300 install -y docker.io docker-compose-v2 unattended-upgrades
systemctl enable --now docker
install -d -m 750 /opt/voltneo
touch /var/lib/voltneo-first-boot-done
