import { Module } from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { initDatabase } from './database/config';
import { ReminderDomainModule } from './domains/reminder/reminder-domain.module';
import { SchedulerDomainModule } from './domains/scheduler/scheduler-domain.module';

@Module({
  imports: [
    initDatabase(),
    ScheduleModule.forRoot(),
    ReminderDomainModule,
    SchedulerDomainModule,
    RouterModule.register([
      {
        path: 'reminder',
        module: ReminderDomainModule,
      },
      {
        path: 'scheduler',
        module: SchedulerDomainModule,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
