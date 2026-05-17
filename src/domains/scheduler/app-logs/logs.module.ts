import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppLog } from './entities/app-log.entity';
import { LogsService } from './logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppLog])],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
