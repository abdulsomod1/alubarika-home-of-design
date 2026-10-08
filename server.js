const { app, PORT } = require('./src/supabase-server');

app.listen(PORT, () => {
  console.log(`Alubarika Home of Designs app is running on http://localhost:${PORT}`);
});