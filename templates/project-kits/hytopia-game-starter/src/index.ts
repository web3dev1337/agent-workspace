import Hytopia from 'hytopia';

// {{projectName}} - Main entry point

const game = new Hytopia.Game({
  name: '{{projectName}}',
});

game.on('playerJoin', (player) => {
  console.log(`Player ${player.username} joined!`);
});

game.start();
