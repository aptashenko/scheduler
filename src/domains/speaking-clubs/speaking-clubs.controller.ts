import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { BookSessionDto } from './dto/book-session.dto';
import { CreateClubSessionDto } from './dto/create-club-session.dto';
import { CreateSpeakingClubDto } from './dto/create-speaking-club.dto';
import { CreateTeacherProfileDto } from './dto/create-teacher-profile.dto';
import { SearchSpeakingClubsDto } from './dto/search-speaking-clubs.dto';
import { SpeakingClubAnalyticsService } from './speaking-club-analytics.service';
import { SpeakingClubBookingsService } from './speaking-club-bookings.service';
import { SpeakingClubsService } from './speaking-clubs.service';

@Controller()
export class SpeakingClubsController {
  constructor(
    private readonly speakingClubsService: SpeakingClubsService,
    private readonly bookingsService: SpeakingClubBookingsService,
    private readonly analyticsService: SpeakingClubAnalyticsService,
  ) {}

  @Post('teachers')
  createTeacherProfile(@Body() dto: CreateTeacherProfileDto) {
    return this.speakingClubsService.createTeacherProfile(dto);
  }

  @Post('clubs')
  createClub(@Body() dto: CreateSpeakingClubDto) {
    return this.speakingClubsService.createClub(dto);
  }

  @Post('sessions')
  createSession(@Body() dto: CreateClubSessionDto) {
    return this.speakingClubsService.createSession(dto);
  }

  @Get('search')
  search(@Query() dto: SearchSpeakingClubsDto) {
    return this.speakingClubsService.search(dto);
  }

  @Post('bookings')
  bookSession(@Body() dto: BookSessionDto) {
    return this.bookingsService.bookSession(dto);
  }

  @Post('bookings/:id/confirm-payment')
  confirmPayment(@Param('id') id: string) {
    return this.bookingsService.confirmManualPayment(Number(id));
  }

  @Get('teachers/:telegramUserId/analytics')
  getTeacherAnalytics(@Param('telegramUserId') telegramUserId: string) {
    return this.analyticsService.getTeacherAnalytics(telegramUserId);
  }

  @Get('clubs/:id/analytics')
  getClubAnalytics(@Param('id') id: string) {
    return this.analyticsService.getClubAnalytics(Number(id));
  }

}
