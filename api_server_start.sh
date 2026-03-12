#!/bin/bash
set -e
pip install -r requirements-python.txt
playwright install chromium
python api_server.py
