const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

/*
   CORS
   Allows the OrangeBrowse frontend to call this Render API
   from a different domain.
*/
app.use((req, res, next) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

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


/* =====================================================
   SEARXNG
===================================================== */

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


/* =====================================================
   HELPERS
===================================================== */

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

  if (!value) {
    return "";
  }

  try {

    return new URL(
      value,
      baseUrl
    ).toString();

  } catch {

    return "";

  }

}


/*
   Extract Open Graph / Twitter image
   from a normal webpage.

   This is only used when a normal web result
   doesn't already contain an image.
*/
function extractPageImage(html, pageUrl) {

  if (!html) {
    return "";
  }

  const patterns = [

    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,

    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i

  ];

  for (const pattern of patterns) {

    const match =
      html.match(pattern);

    if (match && match[1]) {

      return makeAbsoluteUrl(
        match[1],
        pageUrl
      );

    }

  }

  return "";

}


/*
   Only fetch normal HTTP/HTTPS pages.

   Keep the request small and fast.
*/
async function findPageThumbnail(pageUrl) {

  if (!pageUrl) {
    return "";
  }

  let parsed;

  try {

    parsed =
      new URL(pageUrl);

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

          signal:
            controller.signal,

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


    /*
       Don't download huge webpages.
       We only need the beginning where
       metadata normally exists.
    */
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


      const chunk =
        new TextDecoder().decode(
          value
        );


      html += chunk;

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

    const query =
      String(
        req.query.q || ""
      ).trim();


    const category =
      String(
        req.query.category ||
        "general"
      ).trim();


    const page =
      Math.max(
        1,
        parseInt(
          req.query.page ||
          "1",
          10
        )
      );


    if (!query) {

      return res.status(
        400
      ).json({

        error:
          "Missing search query"

      });

    }


    const selectedCategory =
      allowedCategories.includes(
        category
      )
        ? category
        : "general";


    try {

      const url =
        new URL(
          SEARXNG_URL
        );


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
            text.slice(
              0,
              1000
            )

        });

      }


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

          error:
            "SearXNG did not return JSON."

        });

      }


      /*
         =================================================
         GENERAL / ALL RESULT THUMBNAILS
         =================================================

         Images and videos are left untouched.

         For normal web results:
         1. Use image already returned by SearXNG.
         2. If none exists, try the webpage's
            og:image/twitter:image metadata.
      */

      if (
        selectedCategory ===
        "general" &&
        Array.isArray(
          data.results
        )
      ) {

        /*
           Only enrich a small number of results
           so searches don't become unnecessarily slow.
        */

        const resultsToEnrich =
          data.results
            .slice(0, 6);


        await Promise.all(

          resultsToEnrich.map(
            async (result) => {

              /*
                 Don't replace an image that
                 SearXNG already supplied.
              */

              if (
                getExistingImage(
                  result
                )
              ) {

                return;

              }


              const resultUrl =
                result.url ||
                result.link ||
                "";


              if (!resultUrl) {
                return;
              }


              const thumbnail =
                await findPageThumbnail(
                  resultUrl
                );


              if (thumbnail) {

                result.thumbnail =
                  thumbnail;

              }

            }
          )

        );

      }


      res.set(
        "Cache-Control",
        "public, max-age=30"
      );


      return res.status(
        200
      ).json(data);


    } catch (error) {

      return res.status(
        502
      ).json({

        error:
          "Could not reach SearXNG.",

        details:
          error.message

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
