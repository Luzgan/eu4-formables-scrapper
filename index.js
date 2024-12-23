const { chromium } = require("playwright");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

const pernamentBonusRegex =
  /(.*? rest of the game)|(.*? end of the game)|(.*? rest of the campaign)/;

class App {
  browser;
  page;
  host = "https://eu4.paradoxwikis.com";
  countryData = [];

  cacheHtml(id, content) {
    fs.writeFileSync(`_temp/${id}.html`, content, { encoding: "utf8" });
  }

  isHtmlCached(id) {
    return fs.existsSync(`_temp/${id}.html`);
  }

  loadHtmlFromCache(id) {
    return fs.readFileSync(`_temp/${id}.html`, { encoding: "utf8" }).toString();
  }

  async init() {
    if (!fs.existsSync("_temp")) {
      fs.mkdirSync("_temp");
    }

    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();
  }

  async scrapFormables() {
    let html;
    if (this.isHtmlCached("formables")) {
      html = this.loadHtmlFromCache("formables");
    } else {
      await this.page.goto(`${this.host}/Formable_countries`, {
        waitUntil: "networkidle",
        javaScriptEnabled: false,
      });
      await this.page.waitForSelector("table");
      html = await this.page.content();
      this.cacheHtml("formables", html);
    }

    const $ = cheerio.load(html);

    const table = $("table").filter((index, element) => {
      const caption = $(element).find("caption").text().trim();
      return caption === "Non-colonial formable nations";
    });

    table.find("tr").each((index, row) => {
      if (index === 0) return;

      const countryCell = $(row).find("td").eq(0);
      const countryName = $(countryCell).text().trim();
      const countryLink = $(countryCell).find("a").eq(0).attr("href");

      const subcontinentCell = $(row).find("td").eq(1);
      const subcontinentName = $(subcontinentCell).text().trim();

      const requiredCultureCell = $(row).find("td").eq(2);
      const requiredCultureName = $(requiredCultureCell).text().trim();

      const requiredFaithCell = $(row).find("td").eq(3);
      const requiredFaithName = $(requiredFaithCell).text().trim();

      const doRelocateCapitalCell = $(row).find("td").eq(4);
      const doRelocateCapital =
        $(doRelocateCapitalCell).text().trim() === "Yes";

      const doesHaveMissionsCell = $(row).find("td").eq(5);
      const doesHaveMissions = $(doesHaveMissionsCell).text().trim() === "Yes";

      const isEndGameTagCell = $(row).find("td").eq(6);
      const isEndGameTag = $(isEndGameTagCell).text().trim() === "Yes";

      const extraNotesCell = $(row).find("td").eq(7);
      const extraNotes = $(extraNotesCell).text().trim();

      this.countryData.push({
        countryName,
        countryLink,
        countryFullLink: `${this.host}${countryLink}`,
        subcontinentName,
        requiredCultureName,
        requiredFaithName,
        doRelocateCapital,
        doesHaveMissions,
        isEndGameTag,
        extraNotes,
      });
    });
  }

  async scrapMissions() {
    for (const country of this.countryData) {
      if (country.doesHaveMissions) {
        let html;
        if (this.isHtmlCached(country.countryName)) {
          html = this.loadHtmlFromCache(country.countryName);
        } else {
          await this.page.goto(`${this.host}${country.countryLink}`, {
            waitUntil: "networkidle",
            javaScriptEnabled: false,
          });
          await this.page.waitForSelector(".eu4box");
          html = await this.page.content();
          this.cacheHtml(country.countryName, html);
        }

        const $ = cheerio.load(html);
        const missionsRegex = /.*? missions/;
        const missionsLinkNode = $("dl>dd>i>a").filter((index, element) => {
          const title = $(element).attr("title");
          return missionsRegex.test(title);
        });
        const link = $(missionsLinkNode).attr("href");

        if (link) {
          country.missionLink = link;
          country.missionFullLink = `${this.host}${link}`;
          await this.scrapSpecificMissionPage(country);
        }
      }
    }
  }

  async scrapSpecificMissionPage(country) {
    const cacheId = `${country.countryName}Missions`;
    let html;
    if (this.isHtmlCached(cacheId)) {
      html = this.loadHtmlFromCache(cacheId);
    } else {
      await this.page.goto(`${this.host}${country.missionLink}`, {
        waitUntil: "networkidle",
        javaScriptEnabled: false,
      });
      await this.page.waitForSelector("table");
      html = await this.page.content();
      this.cacheHtml(cacheId, html);
    }

    country.missions = [];

    const $ = cheerio.load(html);
    $("table").each((index, row) => {
      $(row)
        .find("tr")
        .each((index, row) => {
          if (index === 0) return;

          const missionDescCell = $(row).find("td").eq(0);
          const missionDesc = $(missionDescCell).text().trim();

          const requirementsCell = $(row).find("td").eq(1);
          const requirements = $(requirementsCell).text().trim();

          const effectsCell = $(row).find("td").eq(2);
          const effects = $(effectsCell).text().trim();

          const doesHavePernamentEffects = pernamentBonusRegex.test(effects);

          country.missions.push({
            missionDesc,
            requirements,
            effects,
            doesHavePernamentEffects,
          });
        });
    });
  }
}

async function startApp() {
  const app = new App();
  await app.init();
  await app.scrapFormables();
  await app.scrapMissions();
  await app.browser.close();

  // Handle data here as you want
  const csvWriter = createCsvWriter({
    path: "results.csv",
    alwaysQuote: true,
    header: [
      { id: "countryName", title: "NAME" },
      { id: "countryFullLink", title: "LINK TO COUNTRY" },
      { id: "missionFullLink", title: "LINK TO MISSIONS" },
    ],
  });
  for (const country of app.countryData) {
    if (
      country?.missions?.find((mission) => mission.doesHavePernamentEffects) &&
      country.isEndGameTag === false
    ) {
      await csvWriter.writeRecords([country]);
    }
  }
}

startApp();
