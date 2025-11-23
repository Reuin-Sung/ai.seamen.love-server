#!/bin/bash
sudo systemctl stop aiseamen.service

lsof -ti:443 | xargs -r kill -9 || true

lsof -ti:80 | xargs -r kill -9 || true

sudo systemctl stop aiseamen.service

git fetch

git pull

npm install

sudo systemctl start aiseamen.service

systemctl status aiseamen.service

journalctl -f -u aiseamen.service