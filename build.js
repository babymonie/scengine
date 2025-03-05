const esbuild = require("esbuild");

const options = {
  entryPoints: ["scengine.js"], // Change this to your entry file
  minify: true,
  bundle: true,
  sourcemap: true,
  external: ["fs", "path", "axios", "cheerio"], // Externalize Node.js built-ins and dependencies,
  platform: 'node',
};

async function build() {
  // CommonJS Build
  await esbuild.build({
    ...options,
    format: "cjs",
    outfile: "dist/index.cjs",
  });

  // ESM Build
  await esbuild.build({
    ...options,
    format: "esm",
    outfile: "dist/index.mjs",
  });

  console.log("Build complete!");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
