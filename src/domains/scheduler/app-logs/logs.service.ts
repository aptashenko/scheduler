import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppLog, AppLogLevel } from './entities/app-log.entity';

@Injectable()
export class LogsService {
  constructor(
    @InjectRepository(AppLog)
    private readonly logsRepository: Repository<AppLog>,
  ) {}

  create(input: {
    organizationId?: number | null;
    level: AppLogLevel;
    source: string;
    message: string;
    stack?: string | null;
    context?: Record<string, unknown> | null;
  }) {
    return this.logsRepository.save(
      this.logsRepository.create({
        organization: input.organizationId
          ? { id: input.organizationId }
          : null,
        level: input.level,
        source: input.source,
        message: input.message,
        stack: input.stack ?? null,
        context: input.context ?? null,
      }),
    );
  }

  logError(input: {
    organizationId?: number | null;
    source: string;
    error: unknown;
    context?: Record<string, unknown> | null;
  }) {
    const normalized = this.normalizeError(input.error);

    return this.create({
      organizationId: input.organizationId,
      level: AppLogLevel.Error,
      source: input.source,
      message: normalized.message,
      stack: normalized.stack,
      context: input.context ?? null,
    });
  }

  findByOrganization(organizationId: number, limit = 100) {
    return this.logsRepository.find({
      where: { organization: { id: organizationId } },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  private normalizeError(error: unknown): { message: string; stack: string | null } {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack ?? null,
      };
    }

    return {
      message: typeof error === 'string' ? error : JSON.stringify(error),
      stack: null,
    };
  }
}
