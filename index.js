const OS = require("os"); // eslint-disable-line
const path = require("path"); // eslint-disable-line
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WebpackShellPluginNext = require("webpack-shell-plugin-next");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const UnusedWebpackPlugin = require("unused-webpack-plugin");
const SentryWebpackPlugin = require("@sentry/webpack-plugin");
const RemovePlugin = require("remove-files-webpack-plugin");

const ROOT_DIR = process.env.INIT_CWD;
const DIST_DIR = path.resolve(ROOT_DIR, "build");

const isProdEnv = process.env.NODE_ENV === "production";

const appVersion = process.env.npm_package_version;
const appBuild = !isProdEnv
  ? "dev"
  : process.env.APP_BUILD || process.env.BITRISE_BUILD_NUMBER || undefined; // undefined makes it mandatory for production

console.log(`⚙️  Building version ${appVersion} (${appBuild})\n`);

const config = {
  mode: isProdEnv ? "production" : "development",
  entry: ["index.jsx"],
  devtool: "source-map",
  target: "web",

  output: {
    path: DIST_DIR,
    filename: "js/[name]-[chunkhash].js",
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
        loader: "file-loader",
        options: {
          name(_, resourceQuery = "") {
            if (resourceQuery.includes("originalName")) {
              return "images/[name].[ext]";
            }

            return "images/[contenthash].[ext]";
          },
        },
      },
      {
        test: /(\.woff)|(\.ttf)/,
        loader: "file-loader",
        options: {
          name: "fonts/[name].[ext]",
        },
      },
      {
        test: /\.s?[c|a]ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          "css-loader",
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: {
                plugins: [["autoprefixer"]],
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
          { loader: "po-loader", options: { format: "raw" } },
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
    new webpack.EnvironmentPlugin({
      // NODE_ENV: 'production' | 'development' | 'test', # this is set up automatically
      APP_BUILD: appBuild,
      APP_VERSION: appVersion,
      APP_MANUAL_TESTING: "", // optional
    }),
    new MiniCssExtractPlugin({
      filename: "css/[name].css",
    }),
    new HtmlWebpackPlugin({
      template: "src/index.html",
      sourceMap: true,
      // https://github.com/marcelklehr/toposort/issues/20
      chunksSortMode: "none",
    }),
    new UnusedWebpackPlugin({
      directories: [path.join(ROOT_DIR, "src")],
      exclude: [
        "*.spec.js",
        "*-test.js",
        "dummy*",
        "cache*",
        "make*",
        "helper*",
      ],
      root: ROOT_DIR,
    }),
  ],
  stats: {
    children: false,
    colors: true,
  },
  cache: true,
  devServer: {
    stats: { colors: true },
    historyApiFallback: true,
  },
};

if (isProdEnv) {
  if (
    !process.env.SENTRY_AUTH_TOKEN ||
    !process.env.SENTRY_ORG_ID ||
    !process.env.SENTRY_PROJECT_ID
  ) {
    throw new Error(
      "Missing one of env vars SENTRY_AUTH_TOKEN || SENTRY_ORG_ID || SENTRY_PROJECT_ID"
    );
  }

  config.plugins.push(
    new SentryWebpackPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG_ID,
      project: process.env.SENTRY_PROJECT_ID,
      release: appVersion,
      include: DIST_DIR,
      ignore: ["node_modules", "webpack.config.js"],
    }),
    new RemovePlugin({
      after: {
        test: [
          {
            folder: DIST_DIR,
            method: (absoluteItemPath) => {
              return new RegExp(/\.map$/, "m").test(absoluteItemPath);
            },
            recursive: true,
          },
        ],
      },
    })
  );
}

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
