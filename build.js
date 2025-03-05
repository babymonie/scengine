const esbuild = require("esbuild");
const { execSync } = require("child_process");
const fs = require("fs");

const options = {
  entryPoints: ["scengine.js"], // Change this to your entry file
  minify: true,
  bundle: true,
  sourcemap: true,
  external: ["fs", "path", "axios", "cheerio"], // Externalize Node.js built-ins and dependencies
  platform: "node",
};

async function getGitChanges() {
  try {
    return execSync("git status --porcelain").toString().trim(); // Check if working directory is clean
  } catch (error) {
    console.error("Error checking git status:", error);
    return null;
  }
}

async function generateCommitMessage() {
  const changes = await getGitChanges();
  if (!changes) return "Updated build and versioning process.";

  let message = "Updated build: ";
  const files = changes.split("\n").slice(0, 5).map(line => line.trim().split(" ")[1]).join(", ");
  message += files.length > 5 ? "Modified multiple files." : `Modified ${files}.`;

  return message.length > 200 ? message.slice(0, 200) + "..." : message;
}

async function build() {
  try {
    console.log("Starting build process...");

    // Ensure a clean working directory before version bump
    const gitChanges = await getGitChanges();
    if (gitChanges) {
      console.log("Uncommitted changes detected, committing changes...");
      execSync("git add .");
      const commitMessage = await generateCommitMessage();
      execSync(`git commit -m "${commitMessage}"`);
    }

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

    // Bump the version safely
    execSync("npm version patch", { stdio: "inherit" });

    // Push changes to git
    execSync("git push", { stdio: "inherit" });

    // Publish to npm
    execSync("npm publish", { stdio: "inherit" });

    console.log("Version updated, committed, and package published!");
  } catch (error) {
    console.error("Build process failed:", error);
    process.exit(1);
  }
}

build();
