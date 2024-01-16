const OS = require("os"); // eslint-disable-line
const path = require("path"); // eslint-disable-line
const webpack = require("webpack");
const glob = require("glob");
const fs = require("fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WebpackShellPluginNext = require("webpack-shell-plugin-next");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const UnusedWebpackPlugin = require("unused-webpack-plugin");
const SentryWebpackPlugin = require("@sentry/webpack-plugin");
const RemovePlugin = require("remove-files-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

const ROOT_DIR = process.env.INIT_CWD;
const DIST_DIR = path.resolve(ROOT_DIR, "build");

const isProdEnv = process.env.NODE_ENV === "production";
const isTestEnv = process.env.NODE_ENV === "test";

const appVersion = process.env.npm_package_version;
const appBuild = !isProdEnv
  ? "dev"
  : process.env.APP_BUILD || process.env.BITRISE_BUILD_NUMBER || undefined; // undefined makes it mandatory for production

const isTypeScript = fs.existsSync(path.join(ROOT_DIR, "tsconfig.json"));

console.log(`⚙️  Building version ${appVersion} (${appBuild})\n`);

const hasPostCSSConfig = fs.existsSync(
  path.join(ROOT_DIR, "postcss.config.js")
);
const hasTailwindConfig = fs.existsSync(
  path.join(ROOT_DIR, "tailwind.config.js")
);
const postCSSOptions = !hasPostCSSConfig
  ? {
      postcssOptions: {
        plugins: hasTailwindConfig
          ? ["autoprefixer", "tailwindcss"]
          : ["autoprefixer"],
      },
    }
  : undefined;

const config = {
  mode: isProdEnv ? "production" : "development",
  entry: glob.sync("./src/index.{ts,tsx,js,jsx}"),
  devtool: isTestEnv ? false : "source-map",
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
    extensions: [".js", ".jsx", ".json", ".tsx", ".ts"],
    preferRelative: true,
  },
  module: {
    rules: [
      {
        test: /^((?!data\.).)*\.(ts|js)x?$/,
        exclude: /(node_modules|vendor(?!\.js))/,
        loader: "babel-loader",
      },
      {
        test: /(\.png)|(\.ico)|(\.svg)|(\.jpg)/,
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
        test: /(\.mp4)|(\.mov)/,
        loader: "file-loader",
        options: {
          name: "videos/[name].[ext]",
        },
      },
      {
        test: /\.s?[c|a]ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { esModule: false } },
          { loader: "postcss-loader", options: postCSSOptions },
          `sass-loader`,
        ],
      },
      {
        // fixes react-leaflet nullish operator - we should remove this in the future
        // https://github.com/PaulLeCam/react-leaflet/pull/926
        test: /@?react-leaflet/,
        use: [
          {
            loader: "string-replace-loader",
            options: {
              search: /\s\?\?\s/i,
              replace: " || ",
              flags: "g",
            },
          },
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
  ],
  stats: {
    children: false,
    colors: true,
  },
  cache: true,
  devServer: {
    historyApiFallback: true,
    allowedHosts: "all",
  },
};

if (!isTestEnv) {
  config.plugins.push(
    new UnusedWebpackPlugin({
      directories: [path.join(ROOT_DIR, "src")],
      exclude: [
        "*.spec.js",
        "*-test.js",
        "dummy*",
        "data*",
        "cache*",
        "make*",
        "helper*",
        "*.md",
        "*.txt",
      ],
      root: ROOT_DIR,
    })
  );
}

if (isTypeScript) {
  config.plugins.push(new ForkTsCheckerWebpackPlugin({ async: false }));
}

if (isProdEnv && process.env.CI) {
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
  config.plugins.push(
    new WebpackShellPluginNext({
      dev: false, // run more than once
      onBuildEnd: {
        scripts: [`npx cap run ios --target ${process.env.DEBUG_IOS}`],
        blocking: true,
        parallel: false,
      },
    })
  );
}

if (process.env.DEBUG_ANDROID) {
  config.plugins.push(
    new WebpackShellPluginNext({
      dev: false, // run more than once
      onBuildEnd: {
        scripts: [`npx cap run android --target ${process.env.DEBUG_ANDROID}`],
        blocking: true,
        parallel: false,
      },
    })
  );
}

module.exports = config;
