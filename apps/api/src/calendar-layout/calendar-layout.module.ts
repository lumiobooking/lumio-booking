import { Module } from '@nestjs/common';
import { CalendarLayoutController } from './calendar-layout.controller';
import { CalendarLayoutService } from './calendar-layout.service';

/** The calendar's technician line-up per salon (staff-layout.ts). */
@Module({
  controllers: [CalendarLayoutController],
  providers: [CalendarLayoutService],
})
export class CalendarLayoutModule {}
