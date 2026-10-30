const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`FilmHouse is screening at http://localhost:${port}`);
});
