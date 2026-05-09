import { TypeOrmModule } from '@nestjs/typeorm';

export function initDatabase() {
  return TypeOrmModule.forRoot({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'password',
    database: process.env.DB_DATABASE ?? 'scheduler',
    autoLoadEntities: true,
    synchronize: process.env.TYPEORM_SYNC !== 'false',
  });
}
