const path = require("path");

module.exports = {
  mode: "production",
  entry: {
    lambda: "./src/lambda.ts",
  },
  target: "node",
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  output: {
    libraryTarget: "commonjs2",
    path: path.resolve(__dirname, ".webpack"),
    filename: "[name].js",
  },
  externals: {
    "aws-sdk": "aws-sdk",
  },
  optimization: {
    minimize: false, // Disable minification for debugging
  },
};
