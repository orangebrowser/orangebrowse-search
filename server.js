const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

/*
   CORS
   Allows the OrangeBrowse frontend to call this Render API
   from a different domain.
*/
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

const SEARXNG_URL =
  process.env.SEARXNG_URL ||
  "http://localhost:8080/search";

const allowedCategories = [
  "general",
  "images",
  "videos",
  "news",
  "map",
  "files",
  "social media"
];

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "OrangeBrowse Search API"
  });
});

app.get("/search", async (req, res) => {
  const query = String(req.query.q || "").trim();

  const category =
    String(
      req.query.category || "general"
    ).trim();

  const page = Math.max(
    1,
    parseInt(
      req.query.page || "1",
      10
    )
  );

  if (!query) {
    return res.status(400).json({
      error: "Missing search query"
    });
  }

  const selectedCategory =
    allowedCategories.includes(category)
      ? category
      : "general";

  try {
    const url =
      new URL(SEARXNG_URL);

    url.searchParams.set(
      "q",
      query
    );

    url.searchParams.set(
      "format",
      "json"
    );

    url.searchParams.set(
      "pageno",
      String(page)
    );

    url.searchParams.set(
      "categories",
      selectedCategory
    );

    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    const text =
      await response.text();

    if (!response.ok) {
      return res.status(
        response.status
      ).json({
        error:
          "SearXNG returned HTTP " +
          response.status,

        details:
          text.slice(0, 1000)
      });
    }

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      return res.status(502).json({
        error:
          "SearXNG did not return JSON."
      });
    }

    res.set(
      "Cache-Control",
      "public, max-age=30"
    );

    return res.status(200).json(data);

  } catch (error) {
    return res.status(502).json({
      error:
        "Could not reach SearXNG.",

      details:
        error.message
    });
  }
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `OrangeBrowse Search API listening on ${PORT}`
    );
  }
);
