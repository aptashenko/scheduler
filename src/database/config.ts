import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { DATABASE_SCHEMAS } from './schemas';

export function initDatabase() {
  return TypeOrmModule.forRootAsync({
    useFactory: () => ({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'password',
      database: process.env.DB_DATABASE ?? 'speaking_clubs',
      autoLoadEntities: true,
      synchronize: process.env.TYPEORM_SYNC_DANGEROUS === 'true',
      extra: {
        options: `-c search_path=${DATABASE_SCHEMAS.speakingClubs},${DATABASE_SCHEMAS.reminder},public`,
      },
    }),
    dataSourceFactory: async (options) => {
      if (!options) {
        throw new Error('TypeORM options are required');
      }
      await ensureDatabaseSchemas(options);
      return new DataSource(options).initialize();
    },
  });
}

async function ensureDatabaseSchemas(options: DataSourceOptions) {
  if (options.type !== 'postgres') {
    return;
  }

  const { Client } = await import('pg');
  const client = new Client({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    database: options.database,
  });

  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${DATABASE_SCHEMAS.reminder}"`);
  await client.query(
    `CREATE SCHEMA IF NOT EXISTS "${DATABASE_SCHEMAS.speakingClubs}"`,
  );
  await client.end();
}
