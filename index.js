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

  async scrapeFormables() {
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

    const trList = table.find("tr");
    let handledHeader = false;
    for (const row of trList) {
      if (handledHeader === false) {
        handledHeader = true;
        continue;
      }

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
    }
  }

  async scrapeMissions() {
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
          await this.scrapeSpecificMissionPage(country);
        }
      }
    }
  }

  async scrapeSpecificMissionPage(country) {
    const cacheId = `${country.missionLink}`;
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
    const missionTables = $("table");
    for (const table of missionTables) {
      const rows = $(table).find("tr");
      let handledHeader = false;
      for (const row of rows) {
        if (handledHeader === false) {
          handledHeader = true;
          continue;
        }

        const missionDescCell = $(row).find("td").eq(0);
        const missionDesc = $(missionDescCell).text().trim();

        const requirementsCell = $(row).find("td").eq(1);
        const requirements = $(requirementsCell).text().trim();

        const effectsCell = $(row).find("td").eq(2);
        const effects = $(effectsCell).text().trim().replace(/\s\s+/g, " ");

        const doesHavePernamentEffects = pernamentBonusRegex.test(effects);

        const missionInfo = {
          missionDesc,
          requirements,
          effects,
          doesHavePernamentEffects,
        };

        const eventRegex =
          /(gets the event "(?<event_name1>.*?)")|(the event "(?<event_name2>.*?)" happens)|(Gets "(?<event_name3>.*?)" event)|(Gets the "(?<event_name4>.*?)" event)|(Trigger event "(?<event_name5>.*?)")/i;
        missionInfo.doesHaveEvent = eventRegex.test(missionInfo.effects);
        if (missionInfo.doesHaveEvent) {
          const matched = missionInfo.effects.match(eventRegex);
          const eventName =
            matched["groups"]?.["event_name1"] ||
            matched["groups"]?.["event_name2"] ||
            matched["groups"]?.["event_name3"] ||
            matched["groups"]?.["event_name4"] ||
            matched["groups"]?.["event_name5"];

          const linkNode = $(effectsCell)
            .find("a")
            .filter((index, el) => {
              return $(el).text().trim() === eventName;
            });

          missionInfo.eventName = eventName;
          missionInfo.eventsLink = linkNode.attr("href").replace(/#.*$/, "");
          missionInfo.eventsLinkFull = `${this.host}${missionInfo.eventsLink}`;

          await this.scrapeSpecificMissionEvent(missionInfo);
        }

        country.missions.push(missionInfo);
      }
    }
  }

  async scrapeSpecificMissionEvent(missionInfo) {
    const cacheId = `${missionInfo.eventsLink}`;
    let html;
    if (this.isHtmlCached(cacheId)) {
      html = this.loadHtmlFromCache(cacheId);
    } else {
      await this.page.goto(missionInfo.eventsLinkFull, {
        waitUntil: "networkidle",
        javaScriptEnabled: false,
      });
      await this.page.waitForSelector(".eu4box");
      html = await this.page.content();
      this.cacheHtml(cacheId, html);
    }

    const $ = cheerio.load(html);
    const eventBox = $(".eu4box").filter((index, el) => {
      const title = $(el).find("h3").eq(0);
      return title === missionInfo.eventName;
    });

    const informationTable = $(eventBox).find("table").eq(1);
    const eventEffects = $(informationTable)
      .find("tr")
      .eq(2)
      .text()
      .trim()
      .replace(/\s\s+/g, " ");
    missionInfo.eventEffects = eventEffects;
    missionInfo.doesEventHavePernamentEffects =
      pernamentBonusRegex.test(eventEffects);
  }
}

async function startApp() {
  const app = new App();
  await app.init();
  await app.scrapeFormables();
  await app.scrapeMissions();
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
      country?.missions?.find(
        (mission) =>
          mission.doesHavePernamentEffects ||
          (mission.doesHaveEvent && mission.doesEventHavePernamentEffects)
      ) &&
      country.isEndGameTag === false
    ) {
      await csvWriter.writeRecords([country]);
    }
  }
}

startApp();
