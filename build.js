const esbuild = require("esbuild");

const options = {
  entryPoints: ["index.js"], // Change this to your entry file
  minify: true,
  bundle: true,
  sourcemap: true,
  platform: 'node',
};

async function build() {
  // CommonJS Build
  await esbuild.build({
    ...options,
    format: "cjs",
    outfile: "dist/scengine.cjs",
  });

  // ESM Build
  await esbuild.build({
    ...options,
    format: "esm",
    outfile: "dist/scengine.mjs",
  });

  console.log("Build complete!");
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
