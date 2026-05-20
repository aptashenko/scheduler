import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, In, MoreThan, Repository } from 'typeorm';
import { UsersService } from './users/users.service';
import { UserRole } from './users/entities/user.entity';
import { CreateClubSessionDto } from './dto/create-club-session.dto';
import { CreateSpeakingClubDto } from './dto/create-speaking-club.dto';
import { CreateStudentProfileDto } from './dto/create-student-profile.dto';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { SearchSpeakingClubsDto } from './dto/search-speaking-clubs.dto';
import { ClubSession } from './entities/club-session.entity';
import { ClubReview } from './entities/club-review.entity';
import { SessionAttendance } from './entities/session-attendance.entity';
import { SessionBooking } from './entities/session-booking.entity';
import {
  ClubSessionStatus,
  SpeakingClubLanguage,
  SpeakingClubLevel,
} from './entities/speaking-club.enums';
import { SpeakingClub } from './entities/speaking-club.entity';
import { StudentProfile } from './entities/student-profile.entity';
import { TeacherProfile } from './entities/teacher-profile.entity';
import { SpeakingClubZoomService } from './speaking-club-zoom.service';

@Injectable()
export class SpeakingClubsService {
  private readonly teacherRoles = [UserRole.Teacher, UserRole.Admin];

  constructor(
    @InjectRepository(TeacherProfile)
    private readonly teacherProfilesRepository: Repository<TeacherProfile>,
    @InjectRepository(StudentProfile)
    private readonly studentProfilesRepository: Repository<StudentProfile>,
    @InjectRepository(SpeakingClub)
    private readonly clubsRepository: Repository<SpeakingClub>,
    @InjectRepository(ClubSession)
    private readonly sessionsRepository: Repository<ClubSession>,
    private readonly usersService: UsersService,
    private readonly zoomService: SpeakingClubZoomService,
  ) {}

  async createTeacherProfile(dto: CreateTeacherProfileDto) {
    this.assertText(dto.telegramUserId, 'telegramUserId');
    this.assertText(dto.displayName, 'displayName');

    const user = await this.usersService.upsertTelegramUser({
      telegramId: dto.telegramUserId,
      firstName: dto.displayName,
      timezone: dto.timezone,
    });
    if (!this.canUseTeacherMode(user.role)) {
      throw new ForbiddenException('Teacher role is required');
    }
    const timezone = dto.timezone ?? user.timezone;
    if (!timezone) {
      throw new BadRequestException('timezone is required');
    }

    const existing = await this.teacherProfilesRepository.findOne({
      where: { telegramUserId: dto.telegramUserId },
    });

    if (existing) {
      existing.displayName = dto.displayName;
      existing.bio = dto.bio ?? existing.bio;
      existing.timezone = timezone;
      return this.teacherProfilesRepository.save(existing);
    }

    return this.teacherProfilesRepository.save(
      this.teacherProfilesRepository.create({
        telegramUserId: dto.telegramUserId,
        user,
        displayName: dto.displayName,
        bio: dto.bio ?? null,
        timezone,
      }),
    );
  }

  async ensureStudentProfile(dto: CreateStudentProfileDto) {
    this.assertText(dto.telegramUserId, 'telegramUserId');

    const user = await this.usersService.upsertTelegramUser({
      telegramId: dto.telegramUserId,
      timezone: dto.timezone,
    });
    const timezone = dto.timezone ?? user.timezone ?? 'UTC';
    const existing = await this.studentProfilesRepository.findOne({
      where: { telegramUserId: dto.telegramUserId },
    });

    if (existing) {
      existing.nativeLanguage = dto.nativeLanguage ?? existing.nativeLanguage;
      existing.learningLanguages =
        dto.learningLanguages ?? existing.learningLanguages;
      existing.timezone = timezone;
      return this.studentProfilesRepository.save(existing);
    }

    return this.studentProfilesRepository.save(
      this.studentProfilesRepository.create({
        telegramUserId: dto.telegramUserId,
        user,
        nativeLanguage: dto.nativeLanguage ?? null,
        learningLanguages: dto.learningLanguages ?? [],
        timezone,
      }),
    );
  }

  async createClub(dto: CreateSpeakingClubDto) {
    this.assertText(dto.title, 'title');
    this.assertEnum(dto.targetLanguage, SpeakingClubLanguage, 'targetLanguage');
    this.assertEnumArray(dto.levels, SpeakingClubLevel, 'levels');
    if (!Array.isArray(dto.supportLanguages) || !dto.supportLanguages.length) {
      throw new BadRequestException('supportLanguages is required');
    }
    if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 15) {
      throw new BadRequestException('durationMinutes must be at least 15');
    }
    if (!Number.isInteger(dto.capacity) || dto.capacity < 1) {
      throw new BadRequestException('capacity must be positive');
    }
    const price = dto.price ?? 0;
    if (!dto.isFree && (!Number.isInteger(price) || price < 1)) {
      throw new BadRequestException('price is required for paid clubs');
    }

    const teacher = await this.teacherProfilesRepository.findOne({
      where: { id: dto.teacherId, user: { role: In(this.teacherRoles) } },
    });
    if (!teacher) {
      throw new NotFoundException('Teacher profile not found');
    }

    return this.clubsRepository.save(
      this.clubsRepository.create({
        teacher,
        title: dto.title,
        description: dto.description ?? null,
        targetLanguage: dto.targetLanguage,
        supportLanguages: dto.supportLanguages,
        level: dto.levels[0],
        levels: dto.levels,
        durationMinutes: dto.durationMinutes,
        capacity: dto.capacity,
        price: dto.isFree ? 0 : price,
        currency: dto.currency ?? 'USD',
        isFree: dto.isFree,
        isActive: true,
      }),
    );
  }

  async createSession(dto: CreateClubSessionDto) {
    this.assertText(dto.startAt, 'startAt');

    const club = await this.clubsRepository.findOne({
      where: {
        id: dto.clubId,
        isActive: true,
        teacher: { user: { role: In(this.teacherRoles) } },
      },
      relations: { teacher: { user: true } },
    });
    if (!club) {
      throw new NotFoundException('Active speaking club not found');
    }

    const timezone = dto.timezone ?? club.teacher.user.timezone ?? club.teacher.timezone;
    if (!timezone) {
      throw new BadRequestException('Teacher timezone is required');
    }
    const startAt = this.parseDate(dto.startAt);
    const endAt = new Date(startAt.getTime() + club.durationMinutes * 60_000);
    const meeting = dto.zoomMeetingId
      ? {
          meetingId: dto.zoomMeetingId,
          joinUrl: dto.zoomJoinUrl ?? null,
        }
      : await this.zoomService.createMeeting({
          title: club.title,
          description: club.description,
          startAt,
          durationMinutes: club.durationMinutes,
          timezone,
        });

    return this.sessionsRepository.save(
      this.sessionsRepository.create({
        club,
        teacher: club.teacher,
        startAt,
        endAt,
        timezone,
        status: ClubSessionStatus.Scheduled,
        zoomJoinUrl: meeting.joinUrl,
        zoomMeetingId: meeting.meetingId,
      }),
    );
  }

  async search(dto: SearchSpeakingClubsDto) {
    this.assertEnum(dto.targetLanguage, SpeakingClubLanguage, 'targetLanguage');
    const supportLanguages = dto.supportLanguages ?? [dto.supportLanguage];
    this.assertEnumArray(
      supportLanguages,
      SpeakingClubLanguage,
      'supportLanguages',
    );
    this.assertEnum(dto.level, SpeakingClubLevel, 'level');

    const clubs = await this.clubsRepository.find({
      where: {
        isActive: true,
        targetLanguage: dto.targetLanguage,
        levels: ArrayContains([dto.level]),
      },
      relations: { teacher: true },
      order: { createdAt: 'DESC' },
    });
    const now = new Date();

    return Promise.all(
      clubs
        .filter((club) =>
          club.supportLanguages.some((language) =>
            supportLanguages.includes(language),
          ),
        )
        .map(async (club) => ({
          ...club,
          upcomingSessions: await this.sessionsRepository.find({
            where: {
              club: { id: club.id },
              status: ClubSessionStatus.Scheduled,
              startAt: MoreThan(now),
            },
            relations: { bookings: true },
            order: { startAt: 'ASC' },
            take: 3,
          }),
        })),
    );
  }

  async listTeacherClubs(telegramUserId: string) {
    const teacher = await this.teacherProfilesRepository.findOne({
      where: { telegramUserId, user: { role: In(this.teacherRoles) } },
    });
    if (!teacher) {
      return [];
    }

    return this.clubsRepository.find({
      where: { teacher: { id: teacher.id }, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async getTeacherClub(telegramUserId: string, clubId: number) {
    const teacher = await this.teacherProfilesRepository.findOne({
      where: { telegramUserId, user: { role: In(this.teacherRoles) } },
    });
    if (!teacher) {
      throw new NotFoundException('Teacher profile not found');
    }

    const club = await this.clubsRepository.findOne({
      where: {
        id: clubId,
        teacher: { id: teacher.id },
        isActive: true,
      },
      relations: { teacher: true },
    });
    if (!club) {
      throw new NotFoundException('Club not found');
    }

    const sessions = await this.sessionsRepository.find({
      where: {
        club: { id: club.id },
        status: ClubSessionStatus.Scheduled,
        startAt: MoreThan(new Date()),
      },
      relations: { bookings: true },
      order: { startAt: 'ASC' },
      take: 3,
    });

    return { club, sessions };
  }

  async listTeacherClubSessions(telegramUserId: string, clubId: number) {
    const { club } = await this.getTeacherClub(telegramUserId, clubId);

    return this.sessionsRepository.find({
      where: { club: { id: club.id } },
      relations: { bookings: true },
      order: { startAt: 'DESC' },
    });
  }

  async getTeacherClubSession(telegramUserId: string, sessionId: number) {
    const session = await this.sessionsRepository.findOne({
      where: { id: sessionId },
      relations: {
        club: { teacher: { user: true } },
        bookings: { student: { user: true } },
      },
    });
    if (
      !session ||
      session.club.teacher.telegramUserId !== telegramUserId ||
      !this.canUseTeacherMode(session.club.teacher.user.role)
    ) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  async findSessionForBooking(sessionId: number) {
    const session = await this.sessionsRepository.findOne({
      where: {
        id: sessionId,
        status: ClubSessionStatus.Scheduled,
        startAt: MoreThan(new Date()),
      },
      relations: { club: true, teacher: true },
    });
    if (!session || !session.club.isActive) {
      throw new NotFoundException('Available session not found');
    }

    return session;
  }

  async getTeacherByTelegramId(telegramUserId: string) {
    return this.teacherProfilesRepository.findOne({
      where: { telegramUserId, user: { role: In(this.teacherRoles) } },
      relations: { user: true },
    });
  }

  async getUserTimezone(telegramUserId: string, fallback = 'UTC') {
    const user = await this.usersService.findByTelegramId(telegramUserId);
    return user?.timezone ?? fallback;
  }

  async setUserTimezone(telegramUserId: string, timezone: string) {
    this.assertText(timezone, 'timezone');
    return this.usersService.setTimezone(telegramUserId, timezone);
  }

  private canUseTeacherMode(role: UserRole) {
    return this.teacherRoles.includes(role);
  }

  private parseDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    return date;
  }

  private assertText(value: string | undefined | null, field: string) {
    if (!value || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
  }

  private assertEnum<T extends object>(value: unknown, enumType: T, field: string) {
    if (!Object.values(enumType).includes(value as never)) {
      throw new BadRequestException(`${field} is invalid`);
    }
  }

  private assertEnumArray<T extends object>(
    value: unknown,
    enumType: T,
    field: string,
  ) {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.some((item) => !Object.values(enumType).includes(item as never))
    ) {
      throw new BadRequestException(`${field} is invalid`);
    }
  }
}

export const speakingClubEntities = [
  TeacherProfile,
  StudentProfile,
  SpeakingClub,
  ClubSession,
  SessionBooking,
  SessionAttendance,
  ClubReview,
];
