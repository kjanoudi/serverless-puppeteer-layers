"use strict";
const chromium = require("chrome-aws-lambda");
const puppeteer = chromium.puppeteer;
const { PendingXHR } = require("pending-xhr-puppeteer");
const userAgent = "prerendercloud-lambda-edge-original-user-agent";

const cleanObject = (myObj) =>
  Object.keys(myObj).forEach((key) => myObj[key] == null && delete myObj[key]);

const elapsedTime = (start) => {
  const hrtime = process.hrtime(start);
  const nanoseconds = hrtime[0] * 1e9 + hrtime[1];
  const milliseconds = nanoseconds / 1e6;
  const seconds = nanoseconds / 1e9;
  return { seconds, milliseconds };
};

module.exports.index = async (event, context) => {
  let browser = null;

  try {
    const start = process.hrtime();
    const args = chromium.args;
    args.push(`--user-agent="${userAgent}"`);
    console.log(`Starting Puppeteer`, args);

    browser = await puppeteer.launch({
      defaultViewport: { width: 1024, height: 800 },
      headless: true,
      executablePath: await chromium.executablePath,
      args,
    });

    const url =
      (event["queryStringParameters"] && event["queryStringParameters"].address) ||
      (event["pathParameters"] && event["pathParameters"].proxy);
    console.log("Fetching", url);
    const page = await browser.newPage();
    const pendingXHR = new PendingXHR(page);
    await page.setUserAgent(userAgent);
    const response = await page.goto(url, {
      waitUntil: ["domcontentloaded", "networkidle0"],
    });
    await Promise.race([
      pendingXHR.waitForAllXhrFinished(),
      new Promise((resolve) => {
        setTimeout(resolve, 3000);
      }),
    ]);
    const result = await page.content();
    const responseHeaders = response.headers();
    const headers = {
      "x-prerender-time": elapsedTime(start).milliseconds,
      "cache-control":
        responseHeaders["cache-control"] ||
        "max-age=0,no-cache,no-store,must-revalidate",
      "content-type": responseHeaders["content-type"],
      "last-modified": responseHeaders["last-modified"],
      "x-cache": responseHeaders["x-cache"],
      "x-amz-cf-pop": responseHeaders["x-amz-cf-pop"],
      via: responseHeaders["via"],
      "x-amz-cf-id": responseHeaders["x-amz-cf-id"],
      etag: responseHeaders["etag"],
    };

    cleanObject(headers);

    console.log("Response", url, responseHeaders["status"], result, headers);

    return {
      statusCode: responseHeaders["status"],
      body: result,
      headers,
    };
  } catch (e) {
    console.log(e, e.message, e.stack);
    return {
      statusCode: 500,
    };
  } finally {
    if (browser) await browser.close();
  }
};
