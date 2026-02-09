#!/usr/bin/env node

const { program } = require('commander');

program
  .name('{{projectName}}')
  .description('{{projectName}} CLI tool')
  .version('1.0.0');

program
  .command('run')
  .description('Run the main command')
  .action(() => {
    console.log('Running {{projectName}}...');
  });

program.parse();
