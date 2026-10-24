const fs = require('fs');
const path = require('path');

// Carrega .env simples (sem depender de dotenv)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const root = path.join(__dirname, '..');

module.exports = {
  root,
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'troque-este-segredo-em-producao',
  isProd: process.env.NODE_ENV === 'production',
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'checkout.db'),
  uploadDir: path.join(root, 'public', 'uploads'),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@admin.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
};
