import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { color, isDev, logger } from '@rsbuild/shared';
import { program, type Command } from '@rsbuild/shared/commander';
import { loadEnv } from '../loadEnv';
import { loadConfig, watchFiles } from './config';
import type { RsbuildMode } from '..';
import { onBeforeRestartServer } from '../server/restart';

export type CommonOptions = {
  config?: string;
  envMode?: string;
  open?: boolean | string;
  host?: string;
  port?: number;
};

export type BuildOptions = CommonOptions & {
  watch?: boolean;
};

export type InspectOptions = CommonOptions & {
  env: RsbuildMode;
  output: string;
  verbose?: boolean;
};

export type DevOptions = CommonOptions;

export type PreviewOptions = CommonOptions;

let commonOpts: CommonOptions = {};

export async function init({
  cliOptions,
  isRestart,
}: {
  cliOptions?: CommonOptions;
  isRestart?: boolean;
}) {
  if (cliOptions) {
    commonOpts = cliOptions;
  }

  try {
    const root = process.cwd();
    const envs = loadEnv({
      cwd: root,
      mode: cliOptions?.envMode,
    });

    if (isDev()) {
      onBeforeRestartServer(envs.cleanup);
    }

    const { content: config, filePath: configFilePath } = await loadConfig({
      cwd: root,
      path: commonOpts.config,
      envMode: commonOpts.envMode,
    });

    const command = process.argv[2];
    if (command === 'dev') {
      const files = [...envs.filePaths];
      if (configFilePath) {
        files.push(configFilePath);
      }

      watchFiles(files);
    }

    const { createRsbuild } = await import('../createRsbuild');

    config.source ||= {};
    config.source.define = {
      ...envs.publicVars,
      ...config.source.define,
    };

    if (commonOpts.open && !config.dev?.startUrl) {
      config.dev ||= {};
      config.dev.startUrl = commonOpts.open;
    }

    if (commonOpts.host) {
      config.server ||= {};
      config.server.host = commonOpts.host;
    }

    if (commonOpts.port) {
      config.server ||= {};
      config.server.port = commonOpts.port;
    }

    return await createRsbuild({
      cwd: root,
      rsbuildConfig: config,
    });
  } catch (err) {
    if (isRestart) {
      logger.error(err);
    } else {
      throw err;
    }
  }
}

const applyCommonOptions = (command: Command) => {
  command
    .option(
      '-c --config <config>',
      'specify the configuration file, can be a relative or absolute path',
    )
    .option(
      '--env-mode <mode>',
      'specify the env mode to load the `.env.[mode]` file',
    );
};

const applyServerOptions = (command: Command) => {
  command
    .option('-o --open [url]', 'open the page in browser on startup')
    .option('--port <port>', 'specify a port number for server to listen')
    .option('--host <host>', 'specify the host that the server listens to');
};

export function runCli() {
  program.name('rsbuild').usage('<command> [options]').version(RSBUILD_VERSION);

  const devCommand = program.command('dev');
  const buildCommand = program.command('build');
  const previewCommand = program.command('preview');
  const inspectCommand = program.command('inspect');

  [devCommand, buildCommand, previewCommand, inspectCommand].forEach(
    applyCommonOptions,
  );

  [devCommand, previewCommand].forEach(applyServerOptions);

  devCommand
    .description('starting the dev server')
    .action(async (options: DevOptions) => {
      try {
        const rsbuild = await init({ cliOptions: options });
        await rsbuild?.startDevServer();
      } catch (err) {
        logger.error('Failed to start dev server.');
        logger.error(err);
        process.exit(1);
      }
    });

  buildCommand
    .option('-w --watch', 'turn on watch mode, watch for changes and rebuild')
    .description('build the app for production')
    .action(async (options: BuildOptions) => {
      try {
        const rsbuild = await init({ cliOptions: options });
        await rsbuild?.build({
          watch: options.watch,
        });
      } catch (err) {
        logger.error('Failed to build.');
        logger.error(err);
        process.exit(1);
      }
    });

  previewCommand
    .description('preview the production build locally')
    .action(async (options: PreviewOptions) => {
      try {
        const rsbuild = await init({ cliOptions: options });

        if (rsbuild && !existsSync(rsbuild.context.distPath)) {
          throw new Error(
            `The output directory ${color.yellow(
              rsbuild.context.distPath,
            )} does not exist, please build the project before previewing.`,
          );
        }

        await rsbuild?.preview();
      } catch (err) {
        logger.error('Failed to start preview server.');
        logger.error(err);
        process.exit(1);
      }
    });

  inspectCommand
    .description('inspect the Rspack and Rsbuild configs')
    .option('--env <env>', 'specify env mode', 'development')
    .option('--output <output>', 'specify inspect content output path', '/')
    .option('--verbose', 'show full function definitions in output')
    .action(async (options: InspectOptions) => {
      try {
        const rsbuild = await init({ cliOptions: options });
        await rsbuild?.inspectConfig({
          env: options.env,
          verbose: options.verbose,
          outputPath: join(rsbuild.context.distPath, options.output),
          writeToDisk: true,
        });
      } catch (err) {
        logger.error('Failed to inspect config.');
        logger.error(err);
        process.exit(1);
      }
    });

  program.parse();
}
