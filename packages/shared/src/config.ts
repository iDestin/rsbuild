import type {
  RsbuildConfig,
  BundlerChainRule,
  NormalizedConfig,
  InspectConfigOptions,
} from './types';
import { logger } from './logger';
import { join } from 'node:path';
import type { minify } from 'terser';
import fse from '../compiled/fs-extra';
import { pick, color, upperFirst } from './utils';
import { getTerserMinifyOptions } from './minimize';

export async function outputInspectConfigFiles({
  rsbuildConfig,
  rawRsbuildConfig,
  bundlerConfigs,
  inspectOptions,
  configType,
}: {
  configType: string;
  rsbuildConfig: NormalizedConfig;
  rawRsbuildConfig: string;
  bundlerConfigs: string[];
  inspectOptions: InspectConfigOptions & {
    outputPath: string;
  };
}) {
  const { outputPath } = inspectOptions;

  const files = [
    {
      path: join(outputPath, 'rsbuild.config.mjs'),
      label: 'Rsbuild Config',
      content: rawRsbuildConfig,
    },
    ...bundlerConfigs.map((content, index) => {
      const suffix = rsbuildConfig.output.targets[index];
      const outputFile = `${configType}.config.${suffix}.mjs`;
      let outputFilePath = join(outputPath, outputFile);

      // if filename is conflict, add a random id to the filename.
      if (fse.existsSync(outputFilePath)) {
        outputFilePath = outputFilePath.replace(/\.mjs$/, `.${Date.now()}.mjs`);
      }

      return {
        path: outputFilePath,
        label: `${upperFirst(configType)} Config (${suffix})`,
        content,
      };
    }),
  ];

  await Promise.all(
    files.map((item) =>
      fse.outputFile(item.path, `export default ${item.content}`),
    ),
  );

  const fileInfos = files
    .map(
      (item) =>
        `  - ${color.bold(color.yellow(item.label))}: ${color.underline(
          item.path,
        )}`,
    )
    .join('\n');

  logger.success(
    `Inspect config succeed, open following files to view the content: \n\n${fileInfos}\n`,
  );
}

/**
 * lodash set type declare.
 * eg. a.b.c; a[0].b[1]
 */
export type GetTypeByPath<
  T extends string,
  C extends Record<string, any>,
> = T extends `${infer K}[${infer P}]${infer S}`
  ? GetTypeByPath<`${K}.${P}${S}`, C>
  : T extends `${infer K}.${infer P}`
    ? GetTypeByPath<P, K extends '' ? C : NonNullable<C[K]>>
    : C[T];

type MinifyOptions = NonNullable<Parameters<typeof minify>[1]>;

export async function getMinify(isProd: boolean, config: NormalizedConfig) {
  if (config.output.disableMinimize || !isProd) {
    return false;
  }
  const minifyJS: MinifyOptions = (await getTerserMinifyOptions(config))
    .terserOptions!;

  return {
    removeComments: false,
    useShortDoctype: true,
    keepClosingSlash: true,
    collapseWhitespace: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    removeEmptyAttributes: true,
    minifyJS,
    minifyCSS: true,
    minifyURLs: true,
  };
}

export async function stringifyConfig(config: unknown, verbose?: boolean) {
  const { default: WebpackChain } = await import('../compiled/webpack-chain');

  // webpackChain.toString can be used as a common stringify method
  const stringify = WebpackChain.toString as (
    config: unknown,
    options: { verbose?: boolean },
  ) => string;

  return stringify(config as any, { verbose });
}

export const chainStaticAssetRule = ({
  rule,
  maxSize,
  filename,
  assetType,
  issuer,
}: {
  rule: BundlerChainRule;
  maxSize: number;
  filename: string;
  assetType: string;
  issuer?: any;
}) => {
  // Rspack not support dataUrlCondition function
  // forceNoInline: "foo.png?__inline=false" or "foo.png?url",
  rule
    .oneOf(`${assetType}-asset-url`)
    .type('asset/resource')
    .resourceQuery(/(__inline=false|url)/)
    .set('generator', {
      filename,
    })
    .set('issuer', issuer);

  // forceInline: "foo.png?inline" or "foo.png?__inline",
  rule
    .oneOf(`${assetType}-asset-inline`)
    .type('asset/inline')
    .resourceQuery(/inline/)
    .set('issuer', issuer);

  // default: when size < dataUrlCondition.maxSize will inline
  rule
    .oneOf(`${assetType}-asset`)
    .type('asset')
    .parser({
      dataUrlCondition: {
        maxSize,
      },
    })
    .set('generator', {
      filename,
    })
    .set('issuer', issuer);
};

export const getDefaultStyledComponentsConfig = (
  isProd: boolean,
  ssr: boolean,
) => {
  return {
    ssr,
    // "pure" is used to improve dead code elimination in production.
    // we don't need to enable it in development because it will slow down the build process.
    pure: isProd,
    displayName: true,
    transpileTemplateLiterals: true,
  };
};

/**
 * Omit unused keys from Rsbuild config passed by user
 */
export const pickRsbuildConfig = (
  rsbuildConfig: RsbuildConfig,
): RsbuildConfig => {
  const keys: Array<keyof RsbuildConfig> = [
    'dev',
    'html',
    'tools',
    'output',
    'source',
    'server',
    'security',
    'performance',
    'moduleFederation',
  ];
  return pick(rsbuildConfig, keys);
};
