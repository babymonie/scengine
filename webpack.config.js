const path = require("path");

module.exports = {
  entry: "./scengine.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "scengine.bundle.js",
    library: "Scengine",
    libraryTarget: "umd",
  },
  target: "node", // Ensure Webpack knows it's a Node.js environment,
  mode: "production",
  resolve: {
    fallback: {
      "fs": false,
      "os": require.resolve("os-browserify/browser"),
      "path": require.resolve("path-browserify"),
      "util": require.resolve("util/"),
      "assert": require.resolve("assert/"),
      "stream": require.resolve("stream-browserify"),
      "readline": false, // Disable if not needed
      "child_process": false // Disable if not needed
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        loader: "babel-loader",
      },
    ],
  },
};
