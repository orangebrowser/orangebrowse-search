const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

/* =====================================================
   CORS
===================================================== */

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});


/* =====================================================
   SEARXNG
===================================================== */

const SEARXNG_URL =
  process.env.SEARXNG_URL ||
  "http://localhost:8080/search";

const allowedCategories = new Set([
  "general",
  "images",
  "videos",
  "news",
  "map",
  "files",
  "social media"
]);


/* =====================================================
   HELPERS
===================================================== */

function cleanText(value) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
}


function getExistingImage(result) {
  return (
    result.thumbnail ||
    result.img_src ||
    result.image ||
    result.thumbnail_src ||
    result.image_url ||
    ""
  );
}


function makeAbsoluteUrl(value, baseUrl) {
  if (!value) return "";

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}


/* =====================================================
   EXTRACT PAGE IMAGE
===================================================== */

function extractPageImage(html, pageUrl) {
  if (!html) return "";

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,

    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      return makeAbsoluteUrl(
        match[1],
        pageUrl
      );
    }
  }

  return "";
}


/* =====================================================
   FIND PAGE THUMBNAIL
===================================================== */

async function findPageThumbnail(pageUrl) {

  if (!pageUrl) {
    return "";
  }

  let parsed;

  try {
    parsed = new URL(pageUrl);
  } catch {
    return "";
  }

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    return "";
  }

  try {

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        5000
      );

    const response =
      await fetch(
        parsed.toString(),
        {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,

          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; OrangeBrowse/1.0)",

            "Accept":
              "text/html,application/xhtml+xml"
          }
        }
      );

    clearTimeout(timeout);

    if (!response.ok) {
      return "";
    }

    const contentType =
      response.headers.get(
        "content-type"
      ) || "";

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      return "";
    }

    const reader =
      response.body?.getReader();

    if (!reader) {
      return "";
    }

    let html = "";
    let total = 0;

    const MAX_BYTES = 250000;

    while (total < MAX_BYTES) {

      const {
        done,
        value
      } = await reader.read();

      if (done) {
        break;
      }

      html +=
        new TextDecoder().decode(
          value
        );

      total += value.length;

      if (
        html.includes(
          "</head>"
        )
      ) {
        break;
      }
    }

    try {
      await reader.cancel();
    } catch {}

    return extractPageImage(
      html,
      parsed.toString()
    );

  } catch {

    return "";
  }
}


/* =====================================================
   NORMALIZE RESULT
===================================================== */

function normalizeResult(result) {

  const url =
    result.url ||
    result.link ||
    result.href ||
    "";

  return {

    title:
      cleanText(
        result.title
      ) || url,

    url,

    content:
      cleanText(
        result.content ||
        result.description ||
        result.snippet ||
        ""
      ),

    thumbnail:
      getExistingImage(
        result
      ) || "",

    img_src:
      result.img_src ||
      "",

    engine:
      Array.isArray(
        result.engines
      )
        ? result.engines
        : [],

    category:
      result.category ||
      "",

    publishedDate:
      result.publishedDate ||
      result.published_date ||
      null
  };
}


/* =====================================================
   HEALTH
===================================================== */

app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      service:
        "OrangeBrowse Search API"

    });

  }
);


/* =====================================================
   SEARCH
===================================================== */

app.get(
  "/search",
  async (req, res) => {

    /*
       IMPORTANT:

       q is the exact text typed by the
       OrangeBrowse user.
    */

    const query =
      cleanText(
        String(
          req.query.q ||
          ""
        )
      );


    const requestedCategory =
      cleanText(
        String(
          req.query.category ||
          "general"
        )
      );


    /*
       Never allow page 0,
       negative pages or NaN.
    */

    const page =
      Math.max(
        1,

        Number.parseInt(
          String(
            req.query.page ||
            "1"
          ),
          10
        ) || 1
      );


    /* =================================================
       EMPTY QUERY
    ================================================= */

    if (!query) {

      return res.status(
        400
      ).json({

        ok: false,

        error:
          "Missing search query",

        query: "",

        page,

        results: [],

        hasResults: false,

        hasNextPage: false

      });

    }


    /* =================================================
       CATEGORY
    ================================================= */

    const selectedCategory =
      allowedCategories.has(
        requestedCategory
      )
        ? requestedCategory
        : "general";


    try {

      /* ===============================================
         BUILD SEARXNG REQUEST
      =============================================== */

      const url =
        new URL(
          SEARXNG_URL
        );


      /*
         EXACT SEARCH QUERY
      */

      url.searchParams.set(
        "q",
        query
      );


      /*
         JSON RESPONSE
      */

      url.searchParams.set(
        "format",
        "json"
      );


      /*
         IMPORTANT FOR PAGINATION
      */

      url.searchParams.set(
        "pageno",
        String(page)
      );


      /*
         SEARCH CATEGORY
      */

      url.searchParams.set(
        "categories",
        selectedCategory
      );


      /* ===============================================
         REQUEST SEARXNG
      =============================================== */

      const response =
        await fetch(
          url.toString(),
          {
            method: "GET",

            headers: {

              Accept:
                "application/json",

              "User-Agent":
                "OrangeBrowse/1.0"

            }
          }
        );


      const text =
        await response.text();


      /* ===============================================
         SEARXNG ERROR
      =============================================== */

      if (!response.ok) {

        return res.status(
          502
        ).json({

          ok: false,

          error:
            "SearXNG returned HTTP " +
            response.status,

          details:
            text.slice(
              0,
              1000
            ),

          query,

          page,

          category:
            selectedCategory,

          results: [],

          hasResults: false,

          hasNextPage: false

        });

      }


      /* ===============================================
         PARSE JSON
      =============================================== */

      let data;

      try {

        data =
          JSON.parse(
            text
          );

      } catch {

        return res.status(
          502
        ).json({

          ok: false,

          error:
            "SearXNG did not return JSON.",

          query,

          page,

          category:
            selectedCategory,

          results: [],

          hasResults: false,

          hasNextPage: false

        });

      }


      /* ===============================================
         RAW RESULTS
      =============================================== */

      const rawResults =
        Array.isArray(
          data.results
        )
          ? data.results
          : [];


      /* ===============================================
         NORMALIZE RESULTS
      =============================================== */

      const results =
        rawResults
          .map(
            normalizeResult
          )
          .filter(
            result =>
              result.url
          );


      /* ===============================================
         THUMBNAILS
      =============================================== */

      if (
        selectedCategory ===
          "general" &&
        results.length
      ) {

        const resultsToEnrich =
          results
            .filter(
              result =>
                !result.thumbnail
            )
            .slice(
              0,
              6
            );


        await Promise.all(

          resultsToEnrich.map(
            async result => {

              const thumbnail =
                await findPageThumbnail(
                  result.url
                );


              if (thumbnail) {

                result.thumbnail =
                  thumbnail;

              }

            }
          )

        );

      }


      /* ===============================================
         PAGINATION
      =============================================== */

      const hasResults =
        results.length > 0;


      /*
         SearXNG does not expose one universal
         last-page value for every engine.

         Therefore an empty returned page means
         there are definitely no more results.

         A non-empty page allows OrangeBrowse
         to request the next page.
      */

      const hasNextPage =
        hasResults;


      /* ===============================================
         RESPONSE
      =============================================== */

      const payload = {

        ok: true,

        /*
           EXACT QUERY SENT
        */

        query,

        /*
           EXACT PAGE RETURNED
        */

        page,

        /*
           CATEGORY USED
        */

        category:
          selectedCategory,

        /*
           CLEAN RESULTS
        */

        results,

        /*
           RESULT COUNT
        */

        number_of_results:
          results.length,

        /*
           WHETHER THIS PAGE HAS RESULTS
        */

        hasResults,

        /*
           WHETHER ORANGEBROWSE MAY REQUEST
           ANOTHER PAGE
        */

        hasNextPage,

        /*
           SEARCH SUGGESTIONS
        */

        suggestions:
          Array.isArray(
            data.suggestions
          )
            ? data.suggestions
            : [],

        /*
           DIRECT ANSWERS
        */

        answers:
          Array.isArray(
            data.answers
          )
            ? data.answers
            : [],

        /*
           INFOBOX RESULTS
        */

        infoboxes:
          Array.isArray(
            data.infoboxes
          )
            ? data.infoboxes
            : []

      };


      /* ===============================================
         IMPORTANT CACHE CONTROL
      ===============================================

         Do NOT cache searches.

         Otherwise:
         Search A -> Search B

         can sometimes receive
         Search A's cached response.
      */

      res.set(
        "Cache-Control",
        "private, no-store"
      );


      res.set(
        "X-OrangeBrowse-Query",
        query
      );


      res.set(
        "X-OrangeBrowse-Page",
        String(page)
      );


      return res.status(
        200
      ).json(
        payload
      );


    } catch (error) {

      return res.status(
        502
      ).json({

        ok: false,

        error:
          "Could not reach SearXNG.",

        details:
          error.message,

        query,

        page,

        category:
          selectedCategory,

        results: [],

        hasResults: false,

        hasNextPage: false

      });

    }

  }
);


/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `OrangeBrowse Search API listening on ${PORT}`
    );

  }
);
