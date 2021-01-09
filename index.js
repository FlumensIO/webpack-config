const OS = require("os"); // eslint-disable-line
const path = require("path"); // eslint-disable-line
const webpack = require("webpack");
const autoprefixer = require("autoprefixer");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WebpackShellPluginNext = require("webpack-shell-plugin-next");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const UnusedWebpackPlugin = require("unused-webpack-plugin");
const checkEnv = require("@flumens/has-env");

const ROOT_DIR = process.env.INIT_CWD;
const DIST_DIR = path.resolve(ROOT_DIR, "build");

checkEnv({
  warn: ["APP_MANUAL_TESTING"],
});

const isDevEnv =
  process.env.NODE_ENV === "development" || process.env.APP_MANUAL_TESTING;
const isProdEnv = process.env.NODE_ENV === "production";
const isTestEnv = process.env.NODE_ENV === "test";

const config = {
  mode: isProdEnv ? "production" : "development",
  entry: ["index.jsx"],
  devtool: !isProdEnv && "source-map",
  target: "web",

  output: {
    path: DIST_DIR,
    filename: "[name]-[chunkhash].js",
    publicPath: "/",
  },
  resolve: {
    modules: [
      path.resolve(ROOT_DIR, "./node_modules/"),
      path.resolve(ROOT_DIR, "./src/"),
    ],
    alias: {},
    extensions: [".js", ".jsx", ".json"],
  },
  module: {
    rules: [
      {
        test: /^((?!data\.).)*\.jsx?$/,
        exclude: /(node_modules|vendor(?!\.js))/,
        loader: "babel-loader",
      },
      {
        test: /(\.png)|(\.svg)|(\.jpg)/,
        loader: "file-loader?name=images/[name].[ext]",
      },
      {
        test: /(\.woff)|(\.ttf)/,
        loader: "file-loader?name=font/[name].[ext]",
      },
      {
        test: /\.s?[c|a]ss$/,
        use: [
          "style-loader",
          MiniCssExtractPlugin.loader,
          {
            loader: "string-replace-loader",
            options: {
              search: "./default-skin.svg",
              replace: "/images/default-skin.svg",
              flags: "g",
            },
          },
          "css-loader?-url",
          {
            loader: "postcss-loader",
            options: {
              sourceMap: true,
              plugins() {
                return [autoprefixer("last 2 version")];
              },
            },
          },
          `sass-loader`,
        ],
      },
      {
        test: /\.pot?$/,
        use: [
          "json-loader",
          "po-loader?format=raw",
          {
            // removes empty translations
            loader: "string-replace-loader",
            options: {
              search: 'msgstr ""\n\n',
              replace: "\n",
              flags: "g",
            },
          },
        ],
      },
    ],
  },

  optimization: {
    runtimeChunk: false,
    splitChunks: {
      maxSize: isProdEnv ? 1000000 : undefined,
      cacheGroups: {
        commons: {
          test: /[\\/]node_modules[\\/]/,
          name: "vendors",
          chunks: "all",
        },
      },
    },
  },

  // ignore file sizes since cordova is localhost
  performance: {
    maxEntrypointSize: 10000000,
    maxAssetSize: 10000000,
  },

  plugins: [
    new webpack.DefinePlugin({
      __ENV__: JSON.stringify(process.env.NODE_ENV || "development"),
      __DEV__: isDevEnv,
      __PROD__: isProdEnv,
      __TEST__: isTestEnv,
    }),
    new MiniCssExtractPlugin({
      filename: "style.css",
    }),
    new HtmlWebpackPlugin({
      template: "src/index.html",
      sourceMap: true,
      // https://github.com/marcelklehr/toposort/issues/20
      chunksSortMode: "none",
    }),
    new webpack.NamedModulesPlugin(),
    new webpack.optimize.OccurrenceOrderPlugin(),
    new UnusedWebpackPlugin({
      directories: [path.join(ROOT_DIR, "src")],
      exclude: ["*.spec.js", "dummy*", "cache*", "make*", "helper*"],
      root: ROOT_DIR,
    }),
  ],
  stats: {
    children: false,
  },
  cache: true,
  devServer: {
    historyApiFallback: true,
  },
};

if (process.env.APP_MANUAL_TESTING) {
  config.entry.push("./test/manual-test-utils.js");
}

if (process.env.DEBUG_IOS) {
  // for some reason script didn't accept ~ or $HOME
  const homedir = OS.homedir(); // eslint-disable-line
  const buildID = process.env.IOS_BUILD_ID;
  config.plugins.push(
    new WebpackShellPluginNext({
      dev: false, // run more than once
      onBuildEnd: {
        scripts: [
          "npx cap copy ios",
          "xcodebuild -workspace ./ios/App/App.xcworkspace -scheme App -sdk iphonesimulator",
          `npx ios-sim launch -d iPhone-6s-Plus ${homedir}/Library/Developer/Xcode/DerivedData/${buildID}/Build/Products/Debug-iphonesimulator/App.app -x`,
        ],
        blocking: true,
        parallel: false,
      },
    })
  );
}

if (process.env.DEBUG_ANDROID) {
  const capacitorConfig = require(`${ROOT_DIR}/capacitor.config.json`); // eslint-disable-line

  config.plugins.push(
    new WebpackShellPluginNext({
      dev: false, // run more than once
      onBuildEnd: {
        scripts: [
          "npx cap copy android",
          "./android/gradlew assembleDebug -p android",
          "adb install -r android/app/build/outputs/apk/debug/app-debug.apk",
          `adb shell am start -n ${capacitorConfig.appId}/.MainActivity`,
        ],
        blocking: true,
        parallel: false,
      },
    })
  );
}

module.exports = config;
