import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SummaryQuerySchema, SummaryQuery } from '@railcrew/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SummaryService } from './summary.service';

@ApiTags('summary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('summary')
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @Get()
  compute(
    @CurrentUser() user: JwtUser,
    @Query(new ZodValidationPipe(SummaryQuerySchema)) query: SummaryQuery,
  ) {
    return this.summaryService.compute(user.userId, query);
  }
}
