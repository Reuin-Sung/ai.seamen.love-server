#!/bin/bash

git pull

sudo systemctl restart aiseamen.service

systemctl status aiseamen.service

journalctl -f -u aiseamen.service
