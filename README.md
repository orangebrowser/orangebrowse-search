# OrangeBrowse Search

GitHub structure:

orangebrowse-search/
├── searxng/
│   ├── Dockerfile
│   └── settings.yml
└── search-api/
    ├── server.js
    └── package.json

## Render service 1 — SearXNG

Runtime: Docker
Root Directory: searxng

## Render service 2 — Search API

Runtime: Node
Root Directory: search-api
Build Command: npm install
Start Command: npm start

Environment variable:

SEARXNG_URL=https://YOUR-SEARXNG-SERVICE.onrender.com/search

After deployment, OrangeBrowse should call:

https://YOUR-SEARCH-API.onrender.com/search?q=YOUR_QUERY&category=general&page=1

Do not commit a real secret key to GitHub.
