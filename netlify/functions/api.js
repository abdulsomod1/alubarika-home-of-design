process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/alubarika-uploads';

const serverless = require('serverless-http');
const { app } = require('../../src/supabase-server');

exports.handler = serverless(app);