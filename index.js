const path = require('path');
const { readFile } = require('fs.promised');
const getWritableDirectory = require('@vercel/build-utils/fs/get-writable-directory'); // eslint-disable-line import/no-extraneous-dependencies
const download = require('@vercel/build-utils/fs/download'); // eslint-disable-line import/no-extraneous-dependencies
const glob = require('@vercel/build-utils/fs/glob'); // eslint-disable-line import/no-extraneous-dependencies
const { createLambda } = require('@vercel/build-utils/lambda'); // eslint-disable-line import/no-extraneous-dependencies

const { log, pip, python, linux } = require('./build-utils');


exports.config = {
  maxLambdaSize: '15mb',
};


exports.build = async ({ files, entrypoint, config }) => {
  log.info(`Files: ${JSON.parse(files)}`);
  log.title('Starting build');
  const systemReleaseContents = await readFile(
    path.join('/etc', 'system-release'),
    'utf8',
  );
  log.info(`Build AMI version: ${systemReleaseContents.trim()}`);

  const runtime = config.runtime || 'python3.8';
  python.validateRuntime(runtime);
  log.info(`Lambda runtime: ${runtime}`);

  const wsgiMod = entrypoint.split('.').shift().replace(/\//g, '.');
  const wsgiApplicationName = config.wsgiApplicationName || 'application';
  const wsgiApplication = `${wsgiMod}.${wsgiApplicationName}`;
  log.info(`WSGI application: ${wsgiApplication}`);

  log.heading('Selecting python version');
  const pythonBin = await python.findPythonBinary(runtime);
  const pyUserBase = await getWritableDirectory();
  process.env.PYTHONUSERBASE = pyUserBase;

  log.heading('Installing pip');
  const pipPath = await pip.downloadAndInstallPip(pythonBin);

  log.heading('Downloading project');
  const srcDir = await getWritableDirectory();
  // eslint-disable-next-line no-param-reassign
  files = await download(files, srcDir);
  process.env.srcDir = srcDir;
  log.heading('Installing handler');
  await pip.install(pipPath, srcDir, __dirname);

  log.heading('Running setup script');
  let setupPath = linux.findRequirements(entrypoint, files);
  if (setupPath) {
    await linux.install(setupPath);
  }

  log.heading('Running pip script');
  const requirementsTxtPath = pip.findRequirements(entrypoint, files);
  if (requirementsTxtPath) {
    await pip.install(pipPath, srcDir, '-r', requirementsTxtPath);
  }
  
  log.heading('Running post script');
  setupPath = linux.findPostRequirements(entrypoint, files);
  if (setupPath) {
    await linux.install(setupPath);
  }

  log.heading('Preparing lambda bundle');

  const lambda = await createLambda({
    files: await glob('**', srcDir),
    handler: 'lambda.handler',
    runtime: `${config.runtime || 'python3.8'}`,
    environment: {
      WSGI_APPLICATION: `${wsgiApplication}`,
    },
  });

  log.title('Done!');

  return {
    [entrypoint]: lambda,
  };
};
