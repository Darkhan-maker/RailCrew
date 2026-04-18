import { Module } from '@nestjs/common';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';
import { TripsModule } from '../trips/trips.module';
import { SalaryModule } from '../salary/salary.module';

@Module({
  imports: [TripsModule, SalaryModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
