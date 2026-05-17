import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { RemindersService } from './reminders.service';

@Controller('reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post()
  create(@Body() createReminderDto: CreateReminderDto) {
    return this.remindersService.create(createReminderDto);
  }

  @Get()
  findAll() {
    return this.remindersService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateReminderDto: UpdateReminderDto) {
    return this.remindersService.update(Number(id), updateReminderDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.remindersService.remove(Number(id));
  }
}
