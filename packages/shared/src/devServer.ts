import type {
  RsbuildConfig,
  StartDevServerOptions,
  StartServerResult,
  Context,
  OnAfterStartDevServerFn,
  OnBeforeStartDevServerFn,
  CompilerTapFn,
  DevServerOptions,
  ServerApi,
} from './types';
import { getAddressUrls } from './url';
import { isFunction } from './utils';
import { getPort } from './port';
import deepmerge from 'deepmerge';
import { color } from './color';
import { logger as defaultLogger, debug, Logger } from './logger';
import { DEFAULT_PORT, DEFAULT_DEV_HOST } from './constants';
import { createAsyncHook } from './createHook';
import { mergeChainedOptions } from './mergeChainedOptions';
import type { Compiler } from '@rspack/core';

type ServerOptions = Exclude<StartDevServerOptions['serverOptions'], undefined>;

export const getServerOptions = (rsbuildConfig: RsbuildConfig) => {
  return {
    output: {
      path: rsbuildConfig.output?.distPath?.root,
      assetPrefix: rsbuildConfig.output?.assetPrefix,
    },
  };
};

export function printServerURLs(
  urls: Array<{ url: string; label: string }>,
  logger: Logger = defaultLogger,
) {
  const message = urls
    .map(({ label, url }) => `  ${`> ${label.padEnd(10)}`}${color.cyan(url)}\n`)
    .join('');

  logger.log(message);
}

export const getDevServerOptions = async ({
  rsbuildConfig,
  serverOptions,
  port,
}: {
  rsbuildConfig: RsbuildConfig;
  serverOptions: ServerOptions;
  port: number;
}): Promise<{
  devConfig: DevServerOptions;
}> => {
  const defaultDevConfig = deepmerge(
    {
      hot: rsbuildConfig.dev?.hmr ?? true,
      watch: true,
      client: {
        port: port.toString(),
      },
      port,
      liveReload: rsbuildConfig.dev?.hmr ?? true,
      devMiddleware: {
        writeToDisk: (file: string) => !file.includes('.hot-update.'),
      },
      https: rsbuildConfig.dev?.https,
    },
    // merge devServerOptions from serverOptions
    (serverOptions.dev as Exclude<typeof serverOptions.dev, boolean>) || {},
  );

  const devConfig = mergeChainedOptions({
    defaults: defaultDevConfig,
    options: rsbuildConfig.tools?.devServer,
    mergeFn: deepmerge,
  });

  return { devConfig };
};

/** The context used by startDevServer. */
export type DevServerContext = Context & {
  hooks: {
    onBeforeStartDevServerHook: ReturnType<
      typeof createAsyncHook<OnBeforeStartDevServerFn>
    >;
    onAfterStartDevServerHook: ReturnType<
      typeof createAsyncHook<OnAfterStartDevServerFn>
    >;
  };
  config: Readonly<RsbuildConfig>;
};

export async function startDevServer<
  Options extends {
    context: DevServerContext;
  },
>(
  options: Options,
  createDevServer: (
    options: Options,
    port: number,
    serverOptions: ServerOptions,
    compiler: StartDevServerOptions['compiler'],
  ) => Promise<ServerApi>,
  {
    open,
    compiler,
    printURLs = true,
    strictPort = false,
    serverOptions = {},
    logger: customLogger,
    getPortSilently,
  }: StartDevServerOptions & {
    defaultPort?: number;
  } = {},
) {
  const logger = customLogger ?? defaultLogger;

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
  }

  const rsbuildConfig = options.context.config;

  const port = await getPort(rsbuildConfig.dev?.port || DEFAULT_PORT, {
    strictPort,
    silent: getPortSilently,
  });

  const host =
    typeof serverOptions?.dev === 'object' && serverOptions?.dev?.host
      ? serverOptions?.dev?.host
      : DEFAULT_DEV_HOST;

  const https =
    typeof serverOptions?.dev === 'object' && serverOptions?.dev?.https
      ? Boolean(serverOptions?.dev?.https)
      : false;

  options.context.devServer = {
    hostname: host,
    port,
    https,
    open,
  };

  const protocol = https ? 'https' : 'http';
  let urls = getAddressUrls(protocol, port, rsbuildConfig.dev?.host);

  if (printURLs) {
    if (isFunction(printURLs)) {
      urls = printURLs(urls);

      if (!Array.isArray(urls)) {
        throw new Error('Please return an array in the `printURLs` function.');
      }
    }

    printServerURLs(urls, logger);
  }

  const server = await createDevServer(options, port, serverOptions, compiler);

  await options.context.hooks.onBeforeStartDevServerHook.call();

  debug('listen dev server');
  await server.init();

  return new Promise<StartServerResult>((resolve) => {
    server.listen(
      {
        host,
        port,
      },
      async (err: Error) => {
        if (err) {
          throw err;
        }

        debug('listen dev server done');

        await options.context.hooks.onAfterStartDevServerHook.call({ port });
        resolve({
          port,
          urls: urls.map((item) => item.url),
          server,
        });
      },
    );
  });
}

type ServerCallbacks = {
  onInvalid: () => void;
  onDone: (stats: any) => void;
};

export const setupServerHooks = (
  compiler: {
    name?: Compiler['name'];
    hooks: {
      compile: CompilerTapFn<ServerCallbacks['onInvalid']>;
      invalid: CompilerTapFn<ServerCallbacks['onInvalid']>;
      done: CompilerTapFn<ServerCallbacks['onDone']>;
    };
  },
  hookCallbacks: ServerCallbacks,
) => {
  if (compiler.name === 'server') {
    return;
  }

  const { compile, invalid, done } = compiler.hooks;

  compile.tap('modern-dev-server', hookCallbacks.onInvalid);
  invalid.tap('modern-dev-server', hookCallbacks.onInvalid);
  done.tap('modern-dev-server', hookCallbacks.onDone);
};

export const isClientCompiler = (compiler: {
  options: {
    target?: Compiler['options']['target'];
  };
}) => {
  const { target } = compiler.options;

  if (target) {
    return Array.isArray(target) ? target.includes('web') : target === 'web';
  }

  return false;
};
