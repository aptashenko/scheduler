const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const sqlDir = path.join(rootDir, 'src', 'database', 'sql');
const migrationOrder = [
  'move-domain-tables-to-schemas.sql',
  'fix-speaking-club-level-enum-sync-state.sql',
  'add-speaking-club-levels.sql',
  'set-speaking-club-users-default-student-role.sql',
  'add-speaking-club-user-timezone.sql',
  'add-zoom-registrants-to-bookings.sql',
  'add-speaking-club-session-reminders.sql',
  'add-reminder-before-notifications.sql',
];

loadEnv(envPath);

const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`Missing database env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const sqlFiles = fs
  .readdirSync(sqlDir)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();
const orderedSqlFiles = [
  ...migrationOrder.filter((fileName) => sqlFiles.includes(fileName)),
  ...sqlFiles.filter((fileName) => !migrationOrder.includes(fileName)),
];
const migrations = orderedSqlFiles.map((fileName) => path.join(sqlDir, fileName));

if (migrations.length === 0) {
  console.log('No SQL migrations found.');
  process.exit(0);
}

for (const migration of migrations) {
  const relativePath = path.relative(rootDir, migration);
  console.log(`Applying ${relativePath}`);

  const result = spawnSync(
    'psql',
    [
      '-h',
      process.env.DB_HOST,
      '-p',
      process.env.DB_PORT,
      '-U',
      process.env.DB_USERNAME,
      '-d',
      process.env.DB_DATABASE,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      migration,
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        PGPASSWORD: process.env.DB_PASSWORD,
      },
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    console.error(`Failed to apply ${relativePath}`);
    process.exit(result.status ?? 1);
  }
}

console.log('SQL migrations applied.');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquote(value);
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
