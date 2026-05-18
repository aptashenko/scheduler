import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, MoreThan, Repository } from 'typeorm';
import { UsersService } from './users/users.service';
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
    this.assertText(dto.timezone, 'timezone');

    const user = await this.usersService.upsertTelegramUser({
      telegramId: dto.telegramUserId,
      firstName: dto.displayName,
    });
    const existing = await this.teacherProfilesRepository.findOne({
      where: { telegramUserId: dto.telegramUserId },
    });

    if (existing) {
      existing.displayName = dto.displayName;
      existing.bio = dto.bio ?? existing.bio;
      existing.timezone = dto.timezone;
      return this.teacherProfilesRepository.save(existing);
    }

    return this.teacherProfilesRepository.save(
      this.teacherProfilesRepository.create({
        telegramUserId: dto.telegramUserId,
        user,
        displayName: dto.displayName,
        bio: dto.bio ?? null,
        timezone: dto.timezone,
      }),
    );
  }

  async ensureStudentProfile(dto: CreateStudentProfileDto) {
    this.assertText(dto.telegramUserId, 'telegramUserId');
    this.assertText(dto.timezone, 'timezone');

    const user = await this.usersService.upsertTelegramUser({
      telegramId: dto.telegramUserId,
    });
    const existing = await this.studentProfilesRepository.findOne({
      where: { telegramUserId: dto.telegramUserId },
    });

    if (existing) {
      existing.nativeLanguage = dto.nativeLanguage ?? existing.nativeLanguage;
      existing.learningLanguages =
        dto.learningLanguages ?? existing.learningLanguages;
      existing.timezone = dto.timezone;
      return this.studentProfilesRepository.save(existing);
    }

    return this.studentProfilesRepository.save(
      this.studentProfilesRepository.create({
        telegramUserId: dto.telegramUserId,
        user,
        nativeLanguage: dto.nativeLanguage ?? null,
        learningLanguages: dto.learningLanguages ?? [],
        timezone: dto.timezone,
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

    const teacher = await this.teacherProfilesRepository.findOneBy({
      id: dto.teacherId,
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
    this.assertText(dto.timezone, 'timezone');

    const club = await this.clubsRepository.findOne({
      where: { id: dto.clubId, isActive: true },
      relations: { teacher: true },
    });
    if (!club) {
      throw new NotFoundException('Active speaking club not found');
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
          timezone: dto.timezone,
        });

    return this.sessionsRepository.save(
      this.sessionsRepository.create({
        club,
        teacher: club.teacher,
        startAt,
        endAt,
        timezone: dto.timezone,
        status: ClubSessionStatus.Scheduled,
        zoomJoinUrl: meeting.joinUrl,
        zoomMeetingId: meeting.meetingId,
      }),
    );
  }

  async search(dto: SearchSpeakingClubsDto) {
    this.assertEnum(dto.targetLanguage, SpeakingClubLanguage, 'targetLanguage');
    this.assertEnum(dto.supportLanguage, SpeakingClubLanguage, 'supportLanguage');
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
        .filter((club) => club.supportLanguages.includes(dto.supportLanguage))
        .map(async (club) => ({
          ...club,
          upcomingSessions: await this.sessionsRepository.find({
            where: {
              club: { id: club.id },
              status: ClubSessionStatus.Scheduled,
              startAt: MoreThan(now),
            },
            order: { startAt: 'ASC' },
            take: 3,
          }),
        })),
    );
  }

  async listTeacherClubs(telegramUserId: string) {
    const teacher = await this.teacherProfilesRepository.findOne({
      where: { telegramUserId },
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
      where: { telegramUserId },
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
      where: { telegramUserId },
    });
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
