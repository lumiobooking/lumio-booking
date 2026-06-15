import { Module } from '@nestjs/common';
import { AssignmentService } from './assignment.service';

// Exposes the assignment rule engine to other modules (BookingsModule).
@Module({
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule {}
