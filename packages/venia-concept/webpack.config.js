require('dotenv').config();

const webpack = require('webpack');
const {
    WebpackTools: {
        MagentoRootComponentsPlugin,
        ServiceWorkerPlugin,
        DevServerReadyNotifierPlugin,
        MagentoResolver,
        UpwardPlugin,
        CriticalCssPlugin,
        PWADevServer
    }
} = require('@magento/pwa-buildpack');
const path = require('path');

const UglifyPlugin = require('uglifyjs-webpack-plugin');
const configureBabel = require('./babel.config.js');

const themePaths = {
    src: path.resolve(__dirname, 'src'),
    output: path.resolve(__dirname, 'web')
};

// mark dependencies for vendor bundle
const libs = [
    'apollo-boost',
    'react',
    'react-dom',
    'react-redux',
    'react-router-dom',
    'redux'
];

module.exports = async function(env) {
    const { mode } = env;

    const babelOptions = configureBabel(mode);

    const enableServiceWorkerDebugging = Boolean(
        process.env.ENABLE_SERVICE_WORKER_DEBUGGING
    );
    const serviceWorkerFileName = process.env.SERVICE_WORKER_FILE_NAME;

    const critical = new CriticalCssPlugin({ mode });

    const config = {
        mode,
        context: __dirname, // Node global for the running script's directory
        entry: {
            client: path.resolve(themePaths.src, 'index.js')
        },
        output: {
            path: themePaths.output,
            publicPath: '/',
            filename: 'js/[name].js',
            strictModuleExceptionHandling: true,
            chunkFilename: 'js/[name]-[chunkhash].js'
        },
        module: {
            rules: [
                {
                    include: [themePaths.src],
                    test: /\.js$/,
                    use: [
                        {
                            loader: 'babel-loader',
                            options: { ...babelOptions, cacheDirectory: true }
                        }
                    ]
                },
                critical.load(),
                {
                    test: /\.(jpg|svg)$/,
                    use: [
                        {
                            loader: 'file-loader',
                            options: {}
                        }
                    ]
                }
            ]
        },
        optimization: {
            noEmitOnErrors: true,
            runtimeChunk: {
                name: 'shared'
            },
            splitChunks: {
                chunks: 'async',
                minSize: 30000,
                maxSize: 100000,
                minChunks: 1,
                maxAsyncRequests: 5,
                maxInitialRequests: 2,
                automaticNameDelimiter: '~',
                name: true,
                cacheGroups: {
                    default: {
                        minChunks: 2,
                        priority: -20,
                        reuseExistingChunk: true
                    }
                }
            }
        },
        resolve: await MagentoResolver.configure({
            paths: {
                root: __dirname
            }
        }),
        plugins: [
            new MagentoRootComponentsPlugin({ mode }),
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(mode),
                // Blank the service worker file name to stop the app from
                // attempting to register a service worker in index.js.
                // Only register a service worker when in production or in the
                // special case of debugging the service worker itself.
                'process.env.SERVICE_WORKER': JSON.stringify(
                    mode === 'production' || enableServiceWorkerDebugging
                        ? serviceWorkerFileName
                        : false
                ),
                /**
                 * TODO: This env var can override the hardcoded product media
                 * path, which we need to hardcode due to
                 * https://github.com/magento/graphql-ce/issues/88
                 */
                'process.env.MAGENTO_BACKEND_PRODUCT_MEDIA_PATH': JSON.stringify(
                    process.env.MAGENTO_BACKEND_PRODUCT_MEDIA_PATH
                )
            }),
            critical,
            new ServiceWorkerPlugin({
                env,
                enableServiceWorkerDebugging,
                serviceWorkerFileName,
                paths: themePaths
            })
        ]
    };
    if (mode === 'development') {
        config.devtool = 'cheap-module-eval-source-map';

        config.devServer = await PWADevServer.configure({
            publicPath: config.output.publicPath,
            serviceWorkerFileName,
            backendDomain: process.env.MAGENTO_BACKEND_DOMAIN,
            paths: themePaths,
            id: 'magento-venia',
            provideSSLCert: true
        });

        config.devServer.stats = {
            assets: false,
            children: false,
            chunks: true,
            chunkGroups: false,
            chunkModules: false,
            chunkOrigins: false,
            errors: true,
            errorDetails: true,
            modules: false,
            warnings: true
        };

        // A DevServer generates its own unique output path at startup. It needs
        // to assign the main outputPath to this value as well.

        config.output.publicPath = config.devServer.publicPath;

        config.plugins.push(
            new webpack.HotModuleReplacementPlugin(),
            new DevServerReadyNotifierPlugin(config.devServer),
            new UpwardPlugin(
                config.devServer,
                path.resolve(__dirname, 'venia-upward.yml')
            )
        );
    } else if (mode === 'production') {

        config.optimization.minimizer = new UglifyPlugin({
            parallel: true,
            uglifyOptions: {
                parse: {
                    ecma: 8
                },
                compress: {
                    ecma: 6
                },
                output: {
                    ecma: 7,
                    semicolons: false
                },
                keep_fnames: true
            }
        });

        config.performance = {
            hints: 'warning'
        };

    } else {
        throw Error(`Unsupported environment mode in webpack config: `);
    }
    return config;
};
