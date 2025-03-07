const axios = require("axios");
const fs = require("fs");
const cheerio = require("cheerio");
const { URL } = require("url");
const puppeteer = require("puppeteer");
const { LRUCache } = require('lru-cache')
const crypto = require("crypto"); // For hashing the script
const DEFAULT_TTL = 1000 * 60 * 5; // 5 minutes
const requestCache = new LRUCache({
  max: 100, // Adjust based on memory constraints
  ttl: DEFAULT_TTL,
});
const regexCache = new Map();

function getCached(cacheKey) {
  return requestCache.get(cacheKey);
}

function setCached(cacheKey, data, ttl = DEFAULT_TTL) {
  requestCache.set(cacheKey, data, { ttl });
}


function getScriptHash(scriptContent) {
  return crypto.createHash("md5").update(scriptContent).digest("hex");
}

function getCacheKey(url, scriptHash) {
  return `${url}::${scriptHash}`;
}


async function fetchWithCache(url, scriptHash, axiosConfig = {}, ttl = DEFAULT_TTL) {
  const cacheKey = getCacheKey(url, scriptHash);
  const cached = getCached(cacheKey);
  if (cached) {
    return cached;
  }
  const response = await axios.get(url, axiosConfig);
  setCached(cacheKey, response.data, ttl);
  return response.data;
}
const transformFunctions = {
  trim: (val, $) => (typeof val === "string" ? val.trim() : val),
  toLowerCase: (val, $) => (typeof val === "string" ? val.toLowerCase() : val),
  toUpperCase: (val, $) => (typeof val === "string" ? val.toUpperCase() : val),
  default: (val, $, defaultVal) => (val == null || val === "" ? defaultVal : val),
  regex: (val, $, pattern, group = "0") => {
    if (typeof val !== "string") return val;
    const re = new RegExp(pattern);
    const match = val.match(re);
    if (match) {
      const index = parseInt(group);
      return match[index] || val;
    }
    return val;
  },
  dateParse: (val, $) => {
    const date = new Date(val);
    return isNaN(date.getTime()) ? val : date.toISOString();
  },
  customJS: (val, $, code) => {
    try {
      const fn = new Function("value", code);
      return fn(val);
    } catch (e) {
      return val;
    }
  },
  regexReplace: (val, $, pattern, replacement) => {
    if (typeof val !== "string") return val;
    pattern = pattern.replace(/\\\\/g, '\\');
    let re = regexCache.get(pattern);
    if (!re) {
      re = new RegExp(pattern);
      regexCache.set(pattern, re);
    }
    return val.replace(re, replacement);
  },
};

function cleanResult(value, $) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanResult(item, $));
  } else if (typeof value === "object" && value !== null) {
    if (value.type && value.children) {
      return $(value).text();
    }
    let newObj = {};
    for (let key in value) {
      newObj[key] = cleanResult(value[key], $);
    }
    return newObj;
  } else {
    return value;
  }
}

function parseBlock(lines, startIndex) {
  let blockLines = [];
  let braceCount = 1;
  let i = startIndex;
  while (i < lines.length && braceCount > 0) {
    const line = lines[i];
    if (line.endsWith("{")) {
      braceCount++;
      blockLines.push(line);
    } else if (line === "}") {
      braceCount--;
      if (braceCount > 0) blockLines.push(line);
    } else {
      blockLines.push(line);
    }
    i++;
  }
  return { blockText: blockLines.join("\n"), newIndex: i };
}

function parseScript(script) {
  script = script.trim();
  const match = script.match(/^([^\{]+)\{([\s\S]+)\}\s*$/);
  if (!match) {
    throw new Error("Invalid script format. Ensure the Scengine is enclosed in { }.");
  }
  const headerParts = match[1].trim().split("|").map((s) => s.trim());
  const url = headerParts[0];
  const config = {};
  for (let i = 1; i < headerParts.length; i++) {
    const [key, value] = headerParts[i].split("=");
    if (key && value) {
      config[key.trim()] = value.trim();
    }
  }
  const instructionsText = match[2].trim();
  const instructions = parseInstructions(instructionsText);
  return { url, config, instructions };
}

function parseInstructions(text) {
  text = text.replace(/}\s*else\s*{/g, "}\nelse {");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

  const instructions = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^if\s*\(.*\)\s*\{$/.test(line)) {
      const conditionMatch = line.match(/^if\s*\((.*)\)\s*\{$/);
      if (!conditionMatch) throw new Error(`Invalid if condition: ${line}`);
      const condition = conditionMatch[1];
      i++;
      const { blockText, newIndex } = parseBlock(lines, i);
      const ifInstructions = parseInstructions(blockText);
      i = newIndex;
      let elseInstructions = null;
      if (i < lines.length && /^else\s*\{$/.test(lines[i])) {
        i++;
        const { blockText: elseBlock, newIndex: elseNewIndex } = parseBlock(lines, i);
        elseInstructions = parseInstructions(elseBlock);
        i = elseNewIndex;
      }
      instructions.push({
        type: "conditional",
        condition,
        ifInstructions,
        elseInstructions,
      });
      continue;
    }
    if (line.endsWith(":{")) {
      const assignVar = line.slice(0, -2).trim();
      i++;
      const { blockText, newIndex } = parseBlock(lines, i);
      const nestedInstructions = parseInstructions(blockText);
      instructions.push({
        type: "block",
        assign: assignVar,
        instructions: nestedInstructions,
      });
      i = newIndex;
      continue;
    }
    {
      let exclude = false;
      if (line.startsWith("!")) {
        exclude = true;
        line = line.slice(1).trim();
      }
      const parts = line.split("=");
      if (parts.length !== 2) {
        throw new Error(`Invalid instruction: ${line}`);
      }
      const lhs = parts[0].trim();
      let assignPart = parts[1].trim();
      let assignVar, transforms = [];
      if (assignPart.includes("|")) {
        const tokens = assignPart.split("|").map((s) => s.trim());
        assignVar = tokens[0];
        transforms = tokens.slice(1).map((token) => {
          const m = token.match(/^(\w+)(?:\((.*)\))?$/);
          if (m) {
            return {
              fn: m[1],
              params: m[2]
                ? m[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
                : [],
            };
          }
          return { fn: token, params: [] };
        });
      } else {
        assignVar = assignPart;
      }
      let literalValue = null;
      if (
        (lhs.startsWith('"') && lhs.endsWith('"')) ||
        (lhs.startsWith("'") && lhs.endsWith("'"))
      ) {
        literalValue = lhs.slice(1, -1);
      }
      let chainParts = null;
      let attribute = null;
      if (!literalValue) {
        const originalChainParts = lhs.split(">").map((s) => s.trim());
        chainParts = originalChainParts.map((part) =>
          part.includes("..") ? part.replace(/\.\./g, ".") : part
        );
        const lastTokenOriginal = originalChainParts[originalChainParts.length - 1];
        if (!lastTokenOriginal.startsWith('.') && lastTokenOriginal.includes(".")) {
          const parts = lastTokenOriginal.split(".");
          chainParts[chainParts.length - 1] = parts[0].trim();
          attribute = parts[1].trim();
        }
      }
      if (literalValue !== null) {
        instructions.push({
          type: "literal",
          literal: literalValue,
          assign: assignVar,
          transforms,
          exclude,
        });
      } else {
        instructions.push({
          type: "extract",
          exclude,
          chain: chainParts,
          attribute,
          assign: assignVar,
          transforms,
        });
      }
      i++;
    }
  }
  return instructions;
}

async function executeInstructions(instructions, context, $, baseElements) {
  if (!context._excluded) context._excluded = {};
  for (const instr of instructions) {
    if (instr.type === "extract") {
      let startingToken = instr.chain[0];
      let elements;
      if (baseElements) {
        elements = baseElements;
      } else if (context[startingToken]) {
        elements = context[startingToken];
      } else {
        elements = $(startingToken).toArray();
      }
      for (let i = 1; i < instr.chain.length; i++) {
        const token = instr.chain[i];
        let newElements = [];
        for (const el of elements) {
          newElements = newElements.concat($(el).find(token).toArray());
        }
        elements = newElements;
      }
      if (instr.attribute) {
        elements = elements.map((el) => $(el).attr(instr.attribute));
      }
      if (instr.transforms && instr.transforms.length > 0) {
        elements = elements.map((val) => {
          let transformed = val;
          for (let { fn, params } of instr.transforms) {
            if (typeof transformFunctions[fn] === "function") {
              transformed = transformFunctions[fn](transformed, $, ...params);
            }
          }
          return transformed;
        });
      }
      context[instr.assign] = elements;
      if (instr.exclude) {
        context._excluded[instr.assign] = true;
      }
    } else if (instr.type === "literal") {
      let value = instr.literal;
      if (instr.transforms && instr.transforms.length > 0) {
        for (let { fn, params } of instr.transforms) {
          if (typeof transformFunctions[fn] === "function") {
            value = transformFunctions[fn](value, $, ...params);
          }
        }
      }
      context[instr.assign] = [value];
      if (instr.exclude) {
        context._excluded[instr.assign] = true;
      }
    } else if (instr.type === "block") {
      let blockContext = {};
      blockContext._excluded = {};
      let baseArray = null;
      for (const binstr of instr.instructions) {
        if (binstr.type === "extract" || binstr.type === "literal") {
          let elems;
          if (binstr.type === "extract") {
            let startingToken = binstr.chain[0];
            if (blockContext[startingToken]) {
              elems = blockContext[startingToken];
            } else if (context[startingToken]) {
              elems = context[startingToken];
            } else {
              elems = $(startingToken).toArray();
            }
            for (let i = 1; i < binstr.chain.length; i++) {
              const token = binstr.chain[i];
              let newElems = [];
              for (const el of elems) {
                newElems = newElems.concat($(el).find(token).toArray());
              }
              elems = newElems;
            }
            if (binstr.attribute) {
              elems = elems.map((el) => $(el).attr(binstr.attribute));
            }
            if (binstr.transforms && binstr.transforms.length > 0) {
              elems = elems.map((val) => {
                let transformed = val;
                for (let { fn, params } of binstr.transforms) {
                  if (typeof transformFunctions[fn] === "function") {
                    transformed = transformFunctions[fn](transformed, $, ...params);
                  }
                }
                return transformed;
              });
            }
            blockContext[binstr.assign] = elems;
          } else if (binstr.type === "literal") {
            let literalVal = binstr.literal;
            if (binstr.transforms && binstr.transforms.length > 0) {
              for (let { fn, params } of binstr.transforms) {
                if (typeof transformFunctions[fn] === "function") {
                  literalVal = transformFunctions[fn](literalVal, $, ...params);
                }
              }
            }
            blockContext[binstr.assign] = [literalVal];
          }
          if (binstr.exclude) {
            blockContext._excluded[binstr.assign] = true;
          }
          if (!baseArray) {
            baseArray = blockContext[binstr.assign];
          }
        } else if (binstr.type === "block") {
          const nestedResult = await executeInstructions(binstr.instructions, blockContext, $, null);
          blockContext[binstr.assign] = nestedResult;
        }
      }
      let combined = [];
      if (baseArray && Array.isArray(baseArray)) {
        for (let i = 0; i < baseArray.length; i++) {
          let obj = {};
          for (const key in blockContext) {
            if (key === "_excluded") continue;
            if (blockContext._excluded && blockContext._excluded[key]) continue;
            const val = blockContext[key];
            obj[key] = Array.isArray(val) ? val[i] : val;
          }
          combined.push(obj);
        }
      } else {
        combined = blockContext;
      }
      context[instr.assign] = combined;
    } else if (instr.type === "conditional") {
      let conditionResult = false;
      try {
        conditionResult = new Function("context", "$", "return (" + instr.condition + ");")(context, $);
      } catch (e) {
        conditionResult = false;
      }
      if (conditionResult) {
        await executeInstructions(instr.ifInstructions, context, $, baseElements);
      } else if (instr.elseInstructions) {
        await executeInstructions(instr.elseInstructions, context, $, baseElements);
      }
    }
  }
  return context;
}

function mergeResults(resultsArray) {
  let merged = {};
  
  for (const result of resultsArray) {
    for (const key in result) {
      if (key === "_excluded") {
        if (!merged["_excluded"]) {
          merged["_excluded"] = {};
        }
        Object.assign(merged["_excluded"], result["_excluded"]);
        continue;
      }
      if (Array.isArray(result[key])) {
        if (!merged[key]) {
          merged[key] = [];
        }
        merged[key] = merged[key].concat(result[key]);
      } else {
       
        if (!merged[key]) {
          merged[key] = [];
        }
        merged[key].push(result[key]);
      }
    }
  }
  return merged;
}

let engines = {};
function registerPlugin(plugin) {
  if (plugin.engines) {
    for (const name in plugin.engines) {
      engines[name] = plugin.engines[name];
    }
  }
  if (plugin.transformFunctions) {
    for (const tf in plugin.transformFunctions) {
      transformFunctions[tf] = plugin.transformFunctions[tf];
    }
  }
}

async function scrape(scriptContent, props = {}) {
  let scriptHash = getScriptHash(scriptContent);
  let { url, config, instructions } = parseScript(scriptContent);

  url = url.replace(/\[(\w+)\]/g, (match, prop) => {
    if (props[prop] !== undefined) {
      return encodeURIComponent(props[prop]);
    }
    return "";
  });

  let combinedResults = {};

  let processPage = async (htmlContent) => {
    const local$ = cheerio.load(htmlContent);
    let context = {};
    await executeInstructions(instructions, context, local$, null);
    return cleanResult(context, local$);
  };

  if (config.engine && config.engine.toLowerCase() === "puppeteer") {
    let browser;
    try {
      browser = await puppeteer.launch();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle2" });

      if (config.paginationType?.toLowerCase() === "scroll") {
        let pageResults = [];
        const limit = config.paginationLimit ? parseInt(config.paginationLimit) : 5;
        for (let i = 0; i < limit; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(1000);
          let html = await page.content();
          pageResults.push(await processPage(html));
        }
        combinedResults = mergeResults(pageResults);
      } else {
        combinedResults = await processPage(await page.content());
        if (config.paginationNext) {
          let pageCount = 1;
          const limit = config.paginationLimit ? parseInt(config.paginationLimit) : 5;
          const nextSelector = config.paginationNext;
          while (pageCount < limit) {
            const nextPageElement = await page.$(nextSelector);
            if (!nextPageElement) break;
            let nextUrl = await page.evaluate((el) => el.href, nextPageElement);
            await page.goto(nextUrl, { waitUntil: "networkidle2" });
            const pageResult = await processPage(await page.content());
            combinedResults = mergeResults([combinedResults, pageResult]);
            pageCount++;
          }
        }
      }
    } finally {
      if (browser) await browser.close();
    }
    return { result: combinedResults, config };
  } else {
    let data = await fetchWithCache(url, scriptHash);
    combinedResults = await processPage(data);
    let $ = cheerio.load(data);

    if (config.paginationAjax) {
      const limit = config.paginationLimit ? parseInt(config.paginationLimit) : 5;
      let ajaxResults = [];
      const concurrency = config.concurrency ? parseInt(config.concurrency) : 1;

      if (concurrency > 1) {
        let ajaxPromises = Array.from({ length: limit }, (_, i) =>
          fetchWithCache(config.paginationAjax.replace("{page}", i + 1), scriptHash)
        );
        let pagesHtml = await Promise.all(ajaxPromises);
        ajaxResults = await Promise.all(pagesHtml.map(processPage));
      } else {
        for (let i = 1; i <= limit; i++) {
          let pageData = await fetchWithCache(config.paginationAjax.replace("{page}", i), scriptHash);
          ajaxResults.push(await processPage(pageData));
        }
      }
      combinedResults = mergeResults(ajaxResults);
    } else if (config.paginationNext) {
      let pageCount = 1;
      const limit = config.paginationLimit ? parseInt(config.paginationLimit) : 5;
      const nextSelector = config.paginationNext;

      while (pageCount < limit) {
        const nextPageElement = $(nextSelector).first();
        if (!nextPageElement || !nextPageElement.attr("href")) break;
        let nextUrl = new URL(nextPageElement.attr("href"), url).toString();
        let nextData = await fetchWithCache(nextUrl, scriptHash);
        const pageResult = await processPage(nextData);
        combinedResults = mergeResults([combinedResults, pageResult]);
        pageCount++;
      }
    }
    return { result: combinedResults, config };
  }
}

module.exports = {
  scrape,
  parseScript,
  parseInstructions,
  executeInstructions,
  transformFunctions,
  registerPlugin
};

if (require.main === module) {
  if (process.argv.length < 3) {
    console.error("Usage: node index.js <script_file> [prop1=val1 prop2=val2 ...]");
    process.exit(1);
  }
  
  const script = fs.readFileSync(process.argv[2], "utf8");
  let props = {};
  if (process.argv.length > 3) {
    for (let i = 3; i < process.argv.length; i++) {
      const [key, value] = process.argv[i].split("=");
      props[key] = value;
    }
  }
  scrape(script, props)
    .then((result) => {
      // Only final results are printed.
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      // If something goes wrong, it's shown here.
      console.error(err);
    });
}