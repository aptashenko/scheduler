import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { forwardRef } from '@nestjs/common';
import { LogsModule } from '../app-logs/logs.module';
import { TelegramModule } from '../telegram/telegram.module';
import { OrganizationUser } from './entities/organization-user.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Organization, OrganizationUser]),
    LogsModule,
    forwardRef(() => TelegramModule),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService, TypeOrmModule],
})
export class OrganizationsModule {}
