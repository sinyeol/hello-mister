import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'release', 'hello-mister-v2-review');
const filesToCopy = [
  ['dist', 'dist'],
  ['electron', 'electron'],
  ['package.json', 'package.json'],
  ['README.md', 'README.md'],
];

async function copyEntry(source, target) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, target, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function main() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  for (const [from, to] of filesToCopy) {
    await copyEntry(path.join(root, from), path.join(outputDir, to));
  }

  await fs.writeFile(
    path.join(outputDir, 'START-REVIEW.bat'),
    [
      '@echo off',
      'setlocal',
      'echo Hello Mister v2.1 review folder',
      'echo This review package uses the local project Electron dependency.',
      `cd /d "${root}"`,
      'npm.cmd run desktop:review',
      'endlocal',
      '',
    ].join('\r\n'),
    'utf8',
  );

  await fs.writeFile(
    path.join(outputDir, 'README-REVIEW.txt'),
    [
      'Hello Mister v2.1 Windows review build',
      '',
      'This is a review folder, not an installer.',
      'It contains the built Vite assets and Electron main/preload files.',
      'START-REVIEW.bat launches the app through the local project dependency with npm.cmd run desktop:review.',
      '',
      'Safety state:',
      '- ROM copy/upload is locked.',
      '- Remote mkdir/rename/delete/overwrite is locked.',
      '- SD flash/format is locked.',
      '- Raw command IPC is not exposed.',
      '',
    ].join('\r\n'),
    'utf8',
  );

  console.log(`Created review build at ${outputDir}`);
}

await main();
